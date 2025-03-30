const mysql = require("mysql2");

const conn = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "fitness",
});

conn.connect((err) => {
  if (err) throw err;
  console.log("Conectat la baza de date!");
});

module.exports = conn;
