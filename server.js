// IMPORTURI
const express = require("express");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const path = require("path");
const session = require("express-session");
const conn = require("./db");

// CONFIG PT EXPRESS
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const expressLayouts = require("express-ejs-layouts");
app.set("view engine", "ejs");
app.locals.isAuth = false;
app.locals.routePath = "/";
app.set("views", path.join(__dirname, "views"));
app.set("layout", "layout");

app.use(expressLayouts);

app.use(
  session({
    secret: "topsecret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.isAuth = !!(req.session && req.session.userId);
  res.locals.routePath = req.path || "/";
  res.locals.error = req.query.error ?? null;
  res.locals.success = req.query.success ?? null;
  res.locals.warning = req.query.warning ?? null;
  next();
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/dashboard");
  });
});

app.use((req, res, next) => {
  res.locals.error = req.query.error ?? null;
  res.locals.success = req.query.success ?? null;
  res.locals.warning = req.query.warning ?? null;
  next();
});

// RUTE
app.get("/register", (req, res) =>
  res.render("register", { error: null, success: null })
);

app.get("/login", (req, res) => {
  res.render("login", { error: null, success: null });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/dashboard", (req, res) => res.render("dashboard"));

app.get("/calculator", (req, res) => res.render("calculator"));

app.get("/result", (req, res) => res.render("result"));

app.get("/profile", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");

  const sql = "SELECT * FROM users WHERE id = ?";
  conn.query(sql, [userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.render("profile", {
        user: {},
        error: "Eroare la citirea profilului.",
        success: null,
      });
    }
    res.render("profile", { user: results[0], error: null, success: null });
  });
});

app.get("/exercitii", (req, res) => {
  conn.query("SELECT * FROM exercitii", (err, results) => {
    if (err) return res.send("Eroare la extragerea exercițiilor.");
    res.render("exercitii", { exercitii: results });
  });
});

app.get("/food-log", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");
  // Verificare TDEE
  const userSql = "SELECT tdee FROM users WHERE id = ?";
  conn.query(userSql, [userId], (err, userResults) => {
    if (err) {
      console.error("Eroare la interogare TDEE:", err);
      return res.render("food-log", {
        mese: { "mic dejun": [], pranz: [], cina: [], gustari: [] },
        totalKcal: 0,
        tdee: 0,
        caloriiRamase: 0,
        error: "Eroare la preluarea TDEE-ului.",
        success: null,
      });
    }

    if (userResults.length === 0 || !userResults[0].tdee) {
      return res.redirect("/profile");
    }

    const tdee = userResults[0].tdee;

    // SELECTARE ALIM
    const sql = `
      SELECT * FROM food_log
      WHERE user_id = ? AND DATE(data) = CURDATE()
    `;

    conn.query(sql, [userId], (err2, results) => {
      if (err2) {
        console.error("Eroare la citirea jurnalului:", err2);
        return res.render("food-log", {
          mese: { "mic dejun": [], pranz: [], cina: [], gustari: [] },
          totalKcal: 0,
          tdee,
          caloriiRamase: tdee,
          error: "Eroare la citirea din jurnal.",
          success: null,
        });
      }

      const mese = {
        "mic dejun": [],
        pranz: [],
        cina: [],
        gustari: [],
      };

      let totalKcal = 0;

      results.forEach((item) => {
        if (mese[item.masa]) {
          mese[item.masa].push(item);
          totalKcal += Number(item.calorii) || 0;
        }
      });

      const caloriiRamase = Math.max(0, tdee - totalKcal);

      res.render("food-log", {
        mese,
        totalKcal,
        tdee,
        caloriiRamase,
      });
    });
  });
});

app.get("/checkin", requireAuth, (req, res) => {
  const uid = req.session.userId;

  const q = `
    SELECT DATE(started_at) AS zi,
           COUNT(*) AS sesiuni,
           COALESCE(SUM(duration_min), 0) AS minute
    FROM workout_checkins
    WHERE user_id = ? AND started_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(started_at)
    ORDER BY zi DESC
  `;

  conn.query(q, [uid], (err, rows) => {
    if (err) {
      console.error(err);
      return res.render("checkin", {
        days: [],
        error: "Nu am putut încărca check-in-urile.",
        success: null,
      });
    }
    res.render("checkin", { days: rows, error: null, success: null });
  });
});

app.post("/profile", (req, res) => {
  const { nume, sex, varsta, greutate, inaltime, activitate, scop } = req.body;
  const userId = req.session?.userId;

  if (!userId) return res.redirect("/login");

  const ageNum = parseInt(varsta);
  const weightNum = parseFloat(greutate);
  const heightNum = parseFloat(inaltime);

  // CALCUL BMR (Harris-Benedict)
  let bmr;
  if (sex === "M") {
    bmr = 10 * weightNum + 6.25 * heightNum - 5 * ageNum + 5;
  } else {
    bmr = 10 * weightNum + 6.25 * heightNum - 5 * ageNum - 161;
  }

  // ACTIVITATE
  const activityFactors = {
    sedentar: 1.2,
    usor: 1.375,
    moderat: 1.55,
    activ: 1.725,
    "foarte activ": 1.9,
  };
  let tdee = bmr * activityFactors[activitate];

  // AJUSTAREA CALORIILOR DUPA SCOP
  if (scop === "slabire") tdee -= 300;
  if (scop === "masa") tdee += 300;

  tdee = Math.round(tdee);

  // ACTUALIZARE USER
  const sql = `
    UPDATE users
    SET nume = ?, sex = ?, varsta = ?, greutate = ?, inaltime = ?, activitate = ?, scop = ?, tdee = ?
    WHERE id = ?
  `;

  conn.query(
    sql,
    [nume, sex, varsta, greutate, inaltime, activitate, scop, tdee, userId],
    (err) => {
      if (err) {
        console.error(err);
        return res.send("Eroare la salvarea profilului.");
      }
      res.redirect("/profile");
    }
  );
});

// SALVAREA ALIMENTULUI IN JURNAL
app.post("/food-log", (req, res) => {
  const { nume, calorii, proteine, carbohidrati, grasimi, masa } = req.body;
  const userId = req.session?.userId || 1;
  const masaNormalizata = masa.trim().toLowerCase();
  const sql = `
    INSERT INTO food_log (user_id, nume, calorii, proteine, carbohidrati, grasimi, masa)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  conn.query(
    sql,
    [userId, nume, calorii, proteine, carbohidrati, grasimi, masaNormalizata],
    (err, result) => {
      if (err) {
        console.error("Eroare MySQL:", err);
        return res.redirect(
          "/food-log?error=" +
            encodeURIComponent("Eroare la salvarea în jurnalul alimentar.")
        );
      }
      res.redirect("/food-log");
    }
  );
});

// INREGISTRARE USER
app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO users (email, password) VALUES (?, ?)";
    conn.query(sql, [email, hashedPassword], (err) => {
      if (err) {
        console.error(err);
        return res.render("register", {
          error: "Deja există un cont cu acest email!",
          success: null,
        });
      }
      res.redirect("/login");
    });
  } catch (error) {
    console.error(error);
    res.send("Eroare server!");
  }
});

// LOGIN USER
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM users WHERE email = ?";
  conn.query(sql, [email], async (err, results) => {
    if (err) {
      console.error(err);
      return res.render("login", {
        error: "Eroare la baza de date!",
        success: null,
      });
    }

    if (results.length === 0) {
      return res.render("login", {
        error: "Utilizatorul nu există.",
        success: null,
      });
    }

    const user = results[0];
    const parolaOk = await bcrypt.compare(password, user.password);
    if (!parolaOk) {
      return res.render("login", { error: "Parolă greșită.", success: null });
    }

    req.session.userId = user.id;
    res.redirect("/dashboard");
  });
});

// CALCULATOR MACRO
app.post("/calculator", (req, res) => {
  const { varsta, sex, inaltime, greutate, activitate, scop } = req.body;
  const ageNum = parseInt(varsta);
  const heightNum = parseFloat(inaltime);
  const weightNum = parseFloat(greutate);

  let bmr;
  if (sex === "M") {
    bmr = 10 * weightNum + 6.25 * heightNum - 5 * ageNum + 5;
  } else if (sex === "F") {
    bmr = 10 * weightNum + 6.25 * heightNum - 5 * ageNum - 161;
  } else {
    return res.send("Sex invalid.");
  }

  const activityFactors = {
    sedentar: 1.2,
    usor: 1.375,
    moderat: 1.55,
    activ: 1.725,
    "foarte activ": 1.9,
  };

  const activityFactor = activityFactors[activitate];
  if (!activityFactor) {
    return res.redirect(
      "/calculator?error=" + encodeURIComponent("Nivel de activitate invalid.")
    );
  }
  let tdee = bmr * activityFactor;
  if (scop === "slabire") tdee -= 300;
  else if (scop === "masa") tdee += 300;

  tdee = Math.round(tdee);
  const proteine = Math.round(weightNum * 2);
  const grasimi = Math.round((tdee * 0.25) / 9);
  const carbohidrati = Math.round((tdee - (proteine * 4 + grasimi * 9)) / 4);

  const userId = req.session?.userId || 1;
  const sql = `
    INSERT INTO macro_results (user_id, calorii, proteine, carbohidrati, grasimi)
    VALUES (?, ?, ?, ?, ?)
  `;

  conn.query(sql, [userId, tdee, proteine, carbohidrati, grasimi], (err) => {
    if (err) {
      console.error(err);
      return res.redirect(
        "/calculator?error=" +
          encodeURIComponent("Eroare la salvarea în baza de date.")
      );
    }

    res.redirect(
      `/result?calorii=${tdee}&proteine=${proteine}&carbohidrati=${carbohidrati}&grasimi=${grasimi}&varsta=${varsta}&greutate=${greutate}&scop=${scop}&activitate=${activitate}`
    );
  });
});

app.post("/delete-food", (req, res) => {
  const { id } = req.body;

  const sql = "DELETE FROM food_log WHERE id = ?";
  conn.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Eroare la ștergere:", err);
      return res.send("Eroare la ștergerea alimentului.");
    }

    res.redirect("/food-log");
  });
});

//UPDATE PROFIL
app.post("/update-profil", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");

  const tdee = parseInt(req.body.calorii);
  const proteine = parseInt(req.body.proteine);
  const carbohidrati = parseInt(req.body.carbohidrati);
  const grasimi = parseInt(req.body.grasimi);
  const varsta = parseInt(req.body.varsta);
  const greutate = parseFloat(req.body.greutate);
  const scop = req.body.scop;
  const activitate = req.body.activitate;

  if (
    isNaN(tdee) ||
    isNaN(proteine) ||
    isNaN(carbohidrati) ||
    isNaN(grasimi) ||
    isNaN(varsta) ||
    isNaN(greutate) ||
    !["slabire", "mentinere", "masa"].includes(scop) ||
    !["sedentar", "usor", "moderat", "activ", "foarte activ"].includes(
      activitate
    )
  ) {
    return res.redirect(
      "/profile?error=" +
        encodeURIComponent("Date invalide pentru actualizarea profilului.")
    );
  }

  const proc_proteine = Math.round((proteine * 4 * 100) / tdee);
  const proc_carbohidrati = Math.round((carbohidrati * 4 * 100) / tdee);
  const proc_grasimi = Math.round((grasimi * 9 * 100) / tdee);

  const sql = `
    UPDATE users
    SET tdee = ?, proc_proteine = ?, proc_carbohidrati = ?, proc_grasimi = ?,
        varsta = ?, greutate = ?, scop = ?, activitate = ?
    WHERE id = ?
  `;

  conn.query(
    sql,
    [
      tdee,
      proc_proteine,
      proc_carbohidrati,
      proc_grasimi,
      varsta,
      greutate,
      scop,
      activitate,
      userId,
    ],
    (err) => {
      if (err) {
        console.error("Eroare la update profil:", err);
        return res.redirect(
          "/profile?error=" +
            encodeURIComponent("Eroare la actualizarea profilului.")
        );
      }
      return res.redirect(
        "/profile?success=" + encodeURIComponent("Profil actualizat.")
      );
    }
  );
});

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.redirect("/login");
  }
  next();
}

function getActiveSession(userId, cb) {
  const q = `
    SELECT id, titlu, start_time
    FROM workout_sessions
    WHERE user_id = ? AND status = 'deschis'
    ORDER BY start_time DESC
    LIMIT 1
  `;
  conn.query(q, [userId], (err, rows) => cb(err, rows?.[0] || null));
}

app.get("/workout-log", requireAuth, (req, res) => {
  const userId = req.session.userId;

  const qToday = `
    SELECT id, titlu, status, start_time
    FROM workout_sessions
    WHERE user_id = ? AND DATE(start_time) = CURDATE()
    ORDER BY start_time DESC
  `;

  getActiveSession(userId, (eA, activeSession) => {
    conn.query(qToday, [userId], (e3, today) => {
      if (e3) {
        console.error(e3);
        return res.render("workout-log", {
          today: [],
          activeSession,
          error: "Eroare la încărcarea sesiunilor de azi.",
        });
      }
      res.render("workout-log", { today, activeSession });
    });
  });
});

//START SESIUNE
app.post("/workout/start", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { titlu } = req.body;

  getActiveSession(userId, (err, active) => {
    if (err) {
      console.error(err);
      return res.redirect("/workout-log");
    }
    if (active) {
      return res.redirect("/workout-log?alreadyOpen=1");
    }

    const sql = `
      INSERT INTO workout_sessions (user_id, titlu, data, start_time, status)
      VALUES (?, ?, CURDATE(), NOW(), 'deschis')
    `;
    conn.query(sql, [userId, titlu || null], (e2, result) => {
      if (e2) {
        console.error(e2);
        return res.redirect("/workout-log");
      }
      res.redirect(`/workout/${result.insertId}`);
    });
  });
});

// CREARE EX PERSONALIZAT
app.post("/workout/custom-create", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const {
    nume,
    grupa,
    muschi_principali,
    muschi_secundari,
    descriere,
    video_url,
  } = req.body;

  if (!nume || !grupa || !muschi_principali) {
    return res.render("workout-log", {
      error: "Completează nume, grupă și mușchi principali.",
      success: null,
      today: [],
      activeSession: null,
      warning: null,
    });
  }

  const q = `
    INSERT INTO exercitii_custom
      (user_id, nume, grupa, muschi_principali, muschi_secundari, descriere, video_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  conn.query(
    q,
    [
      userId,
      nume,
      grupa,
      muschi_principali,
      muschi_secundari || "",
      descriere || "",
      video_url || null,
    ],
    (err) => {
      if (err) {
        console.error(err);
        return res.render("workout-log", {
          error: "Nu am putut salva exercițiul.",
          success: null,
          today: [],
          activeSession: null,
          warning: null,
        });
      }
      res.redirect("/workout-log");
    }
  );
});

app.post("/workout/:sessionId/delete", requireAuth, (req, res) => {
  const sid = req.params.sessionId;
  const uid = req.session.userId;

  // (PERMITE DOAR STERGEREA ANTRENAMENTELOR DE AZI)
  const q =
    "DELETE FROM workout_sessions WHERE id = ? AND user_id = ? AND DATE(start_time) = CURDATE()";

  conn.query(q, [sid, uid], (err, result) => {
    if (err) {
      console.error(err);
      return res.redirect(
        "/workout-log?error=Nu%20am%20putut%20șterge%20sesiunea."
      );
    }
    if (result.affectedRows === 0) {
      return res.redirect(
        "/workout-log?error=Sesiunea%20nu%20poate%20fi%20ștearsă."
      );
    }
    return res.redirect("/workout-log?deleted=1");
  });
});

app.get("/workout/:sessionId", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const sid = req.params.sessionId;

  const qSess = "SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?";
  const qGlobal =
    "SELECT id, nume, grupa, muschi_principali, muschi_secundari FROM exercitii ORDER BY nume ASC";
  const qCustom =
    "SELECT id, nume, grupa, muschi_principali, muschi_secundari FROM exercitii_custom WHERE user_id = ? ORDER BY created_at DESC";
  const qWEx = `
    SELECT we.id AS wex_id, we.nume_cache, we.ord
    FROM workout_exercises we
    WHERE we.session_id = ?
    ORDER BY we.ord, we.id
  `;
  const qSets = `
    SELECT ws.id, ws.workout_exercise_id, ws.set_number, ws.reps, ws.kg
    FROM workout_sets ws
    JOIN workout_exercises we ON we.id = ws.workout_exercise_id
    WHERE we.session_id = ?
    ORDER BY we.ord, we.id, ws.set_number
  `;

  conn.query(qSess, [sid, userId], (e1, sess) => {
    if (e1 || !sess.length) return res.redirect("/workout-log");
    conn.query(qGlobal, (e2, glob) => {
      if (e2) return res.redirect("/workout-log");
      conn.query(qCustom, [userId], (e3, cust) => {
        if (e3) return res.redirect("/workout-log");
        conn.query(qWEx, [sid], (e4, wex) => {
          if (e4) return res.redirect("/workout-log");
          conn.query(qSets, [sid], (e5, sets) => {
            if (e5) return res.redirect("/workout-log");
            res.render("workout-session", {
              session: sess[0],
              globalEx: glob,
              customEx: cust,
              wex,
              sets,
            });
          });
        });
      });
    });
  });
});

// ADAUGA LISTA DE EX DIN BD
app.post("/workout/:sessionId/add-exercise-global", requireAuth, (req, res) => {
  const sid = req.params.sessionId;
  const { exercitiu_id, ord } = req.body;

  const q =
    "SELECT nume, grupa, muschi_principali, muschi_secundari FROM exercitii WHERE id = ?";
  conn.query(q, [exercitiu_id], (e, rows) => {
    if (e || !rows.length) return res.redirect(`/workout/${sid}`);
    const ex = rows[0];
    const ins = `
      INSERT INTO workout_exercises
        (session_id, source, exercise_ref_id, nume_cache, grupa_cache, muschi_principali_cache, muschi_secundari_cache, ord)
      VALUES (?, 'global', ?, ?, ?, ?, ?, ?)
    `;
    conn.query(
      ins,
      [
        sid,
        exercitiu_id,
        ex.nume,
        ex.grupa,
        ex.muschi_principali,
        ex.muschi_secundari || "",
        ord || 1,
      ],
      () => {
        res.redirect(`/workout/${sid}`);
      }
    );
  });
});

// ADAUGARE EX CUSTOM
app.post("/workout/:sessionId/add-exercise-custom", requireAuth, (req, res) => {
  const sid = req.params.sessionId;
  const userId = req.session.userId;
  const { custom_id, ord } = req.body;

  const q =
    "SELECT nume, grupa, muschi_principali, muschi_secundari FROM exercitii_custom WHERE id = ? AND user_id = ?";
  conn.query(q, [custom_id, userId], (e, rows) => {
    if (e || !rows.length) return res.redirect(`/workout/${sid}`);
    const ex = rows[0];
    const ins = `
      INSERT INTO workout_exercises
        (session_id, source, exercise_ref_id, nume_cache, grupa_cache, muschi_principali_cache, muschi_secundari_cache, ord)
      VALUES (?, 'custom', ?, ?, ?, ?, ?, ?)
    `;
    conn.query(
      ins,
      [
        sid,
        custom_id,
        ex.nume,
        ex.grupa,
        ex.muschi_principali,
        ex.muschi_secundari || "",
        ord || 1,
      ],
      () => {
        res.redirect(`/workout/${sid}`);
      }
    );
  });
});

// ADAUGARE SET (REPS/KG)
app.post("/workout/:sessionId/add-set", requireAuth, (req, res) => {
  const sid = req.params.sessionId;
  const { wex_id, set_number, reps, kg } = req.body;
  const q =
    "INSERT INTO workout_sets (workout_exercise_id, set_number, reps, kg) VALUES (?, ?, ?, ?)";
  conn.query(q, [wex_id, set_number, reps, kg], () =>
    res.redirect(`/workout/${sid}?restStart=1`)
  );
});

// STERGERE SET
app.post("/workout/:sessionId/set/:setId/delete", requireAuth, (req, res) => {
  const sid = req.params.sessionId;
  const setId = req.params.setId;
  const uid = req.session.userId;

  const q = `
    DELETE ws FROM workout_sets ws
    JOIN workout_exercises we ON we.id = ws.workout_exercise_id
    JOIN workout_sessions s ON s.id = we.session_id
    WHERE ws.id = ? AND s.id = ? AND s.user_id = ?
  `;

  conn.query(q, [setId, sid, uid], (err, result) => {
    if (err) {
      console.error(err);
      return res.redirect(
        `/workout/${sid}?error=${encodeURIComponent(
          "Nu am putut șterge setul."
        )}`
      );
    }
    if (result.affectedRows === 0) {
      return res.redirect(
        `/workout/${sid}?error=${encodeURIComponent(
          "Setul nu a fost găsit sau nu ai dreptul să-l ștergi."
        )}`
      );
    }
    return res.redirect(
      `/workout/${sid}?success=${encodeURIComponent("Set șters.")}`
    );
  });
});

app.post("/workout/:sessionId/rest", requireAuth, (req, res) => {
  const sid = req.params.sessionId;
  let secs = parseInt(req.body.rest_seconds, 10);
  if (isNaN(secs) || secs < 10) secs = 10;
  if (secs > 600) secs = 600;
  conn.query(
    "UPDATE workout_sessions SET rest_seconds = ? WHERE id = ? AND user_id = ?",
    [secs, sid, req.session.userId],
    () =>
      res.redirect(
        `/workout/${sid}?success=${encodeURIComponent(
          "Timpul de pauză a fost salvat."
        )}`
      )
  );
});

// INCHIDERE SESIUNE ANTRENAMENT
app.post("/workout/:sessionId/close", requireAuth, (req, res) => {
  const sid = req.params.sessionId;
  const uid = req.session.userId;

  const qClose = `
    UPDATE workout_sessions
    SET end_time = NOW(), status = 'inchis'
    WHERE id = ? AND user_id = ?
  `;
  conn.query(qClose, [sid, uid], (e1) => {
    if (e1) {
      console.error(e1);
      return res.redirect(
        "/workout-log?error=" +
          encodeURIComponent("Nu am putut închide sesiunea.")
      );
    }

    const qGet = `SELECT start_time, end_time FROM workout_sessions WHERE id = ? AND user_id = ?`;
    conn.query(qGet, [sid, uid], (e2, rows) => {
      if (e2 || !rows.length) {
        return res.redirect(
          "/workout-log?success=" +
            encodeURIComponent("Antrenamentul a fost închis.")
        );
      }
      const { start_time, end_time } = rows[0];
      const qUpsert = `
        INSERT INTO workout_checkins (user_id, session_id, started_at, ended_at, duration_min)
        VALUES (?, ?, ?, ?, TIMESTAMPDIFF(MINUTE, ?, ?))
        ON DUPLICATE KEY UPDATE
          ended_at = VALUES(ended_at),
          duration_min = VALUES(duration_min)
      `;
      conn.query(
        qUpsert,
        [uid, sid, start_time, end_time, start_time, end_time],
        (e3) => {
          if (e3) console.error(e3);
          return res.redirect(
            "/workout-log?success=" +
              encodeURIComponent("Antrenamentul a fost închis.")
          );
        }
      );
    });
  });
});

// CONSOLA
app.listen(5500, () => {
  console.log("http://localhost:5500/dashboard");
});
