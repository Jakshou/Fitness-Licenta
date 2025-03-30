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

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  session({
    secret: "topsecret",
    resave: false,
    saveUninitialized: false,
  })
);

// RUTE
app.get("/register", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "register.html"))
);
app.get("/login", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "login.html"))
);
app.get("/logout", (req, res) => res.redirect("/login"));
app.get("/dashboard", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
);
app.get("/calculator", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "calculator.html"))
);
app.get("/result", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "result.html"))
);

app.get("/profile", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");

  const sql = "SELECT * FROM users WHERE id = ?";
  conn.query(sql, [userId], (err, results) => {
    if (err || results.length === 0) {
      console.error(err);
      return res.send("Eroare la citirea profilului.");
    }

    const user = results[0];
    res.render("profile", { user });
  });
});

app.get("/food-log", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");

  // TDEE-UL UTILIZATORULUI
  const userSql = "SELECT tdee FROM users WHERE id = ?";
  conn.query(userSql, [userId], (err, userResults) => {
    if (err || userResults.length === 0) {
      console.error(err);
      return res.send("Eroare la preluarea TDEE-ului.");
    }

    const tdee = userResults[0].tdee || 0;

    // ALIMENTELE CONSUMATE ASTAZI
    const sql = `
      SELECT * FROM food_log
      WHERE user_id = ? AND DATE(data) = CURDATE()
    `;

    conn.query(sql, [userId], (err, results) => {
      if (err) {
        console.error(err);
        return res.send("Eroare la citirea din jurnal.");
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

      // TRIMITERE DATE IN VIEW
      res.render("food-log", {
        mese,
        totalKcal,
        tdee,
        caloriiRamase,
      });
    });
  });
});

app.post("/profile", (req, res) => {
  const { nume, sex, varsta, greutate, inaltime, activitate, scop } = req.body;
  const userId = req.session?.userId;

  if (!userId) return res.redirect("/login");

  // Convertim pentru calcul
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

  // Activitate
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

// AFISAREA JURNALULUI DIN BD
app.get("/food-log", (req, res) => {
  const userId = req.session?.userId || 1;

  const sql = `
    SELECT * FROM food_log
    WHERE user_id = ?
    AND DATE(data) = CURDATE()
  `;

  conn.query(sql, [userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.send("Eroare la citirea din baza de date.");
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

    res.render("food-log", { mese, totalKcal });
  });
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
        return res.send("Eroare la salvarea în jurnalul alimentar.");
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
        return res.send("Deja există un cont cu acest email!");
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
      return res.send("Eroare la căutare în baza de date.");
    }

    if (results.length === 0) {
      return res.send("Utilizatorul nu există.");
    }

    const user = results[0];
    const parolaOk = await bcrypt.compare(password, user.password);
    if (!parolaOk) {
      return res.send("Parolă greșită.");
    }

    req.session.userId = user.id;
    res.redirect("/dashboard");
  });
});

// CALCULATOR MACRO
app.post("/calculator", (req, res) => {
  const { age, sex, height, weight, activity, goal } = req.body;
  const ageNum = parseInt(age);
  const heightNum = parseFloat(height);
  const weightNum = parseFloat(weight);

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

  const activityFactor = activityFactors[activity];
  if (!activityFactor) return res.send("Nivel de activitate invalid.");

  let tdee = bmr * activityFactor;
  if (goal === "slabire") tdee -= 300;
  else if (goal === "masa") tdee += 300;

  tdee = Math.round(tdee);
  const proteinGrams = Math.round(weightNum * 2);
  const fatsGrams = Math.round((tdee * 0.25) / 9);
  const carbsGrams = Math.round(
    (tdee - (proteinGrams * 4 + fatsGrams * 9)) / 4
  );

  const userId = req.session?.userId || 1;
  const sql = `
    INSERT INTO macro_results (user_id, calorii, proteine, carbohidrati, grasimi)
    VALUES (?, ?, ?, ?, ?)
  `;

  conn.query(
    sql,
    [userId, tdee, proteinGrams, carbsGrams, fatsGrams],
    (err) => {
      if (err) {
        console.error(err);
        return res.send("Eroare la salvarea în baza de date.");
      }

      res.redirect(
        `/result?calories=${tdee}&proteins=${proteinGrams}&carbs=${carbsGrams}&fats=${fatsGrams}`
      );
    }
  );
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

// CONSOLA
app.listen(5500, () => {
  console.log("🚀 http://localhost:5500/login");
});
