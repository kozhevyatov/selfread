// Палитра применяется до отрисовки, чтобы не было «вспышки» чужих цветов.
// Отдельным файлом, а не внутри index.html: политика безопасности (CSP) запрещает встроенные скрипты.
try {
  var t = JSON.parse(localStorage.getItem("sr-theme") || "null") || { palette: "paper" };
  var p = t.auto ? (matchMedia("(prefers-color-scheme: dark)").matches ? t.night : t.day) : t.palette;
  p = p || "paper";
  document.documentElement.dataset.palette = p;
  document.documentElement.classList.toggle("dark", p === "library");
  var colors = { paper: "#F6F1E7", ink: "#EEF1F5", library: "#14231D" };
  document.querySelector('meta[name="theme-color"]').setAttribute("content", colors[p] || colors.paper);
} catch (e) {}
