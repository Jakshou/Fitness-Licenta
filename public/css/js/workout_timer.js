document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("session-root");
  const restDisplay = document.getElementById("restDisplay");
  const restBar = document.getElementById("restBar");
  const btnStart = document.getElementById("btnStart");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");

  if (!root || !restDisplay || !restBar || !btnStart || !btnPause || !btnReset) {
    return;
  }

  const defaultRest = Number(root.dataset.rest || 60);

  let total = defaultRest;
  let left = total;
  let timerId = null;
  let running = false;

  function format(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function render() {
    restDisplay.textContent = format(left);
    const pct = Math.max(0, Math.min(100, ((total - left) / total) * 100));
    restBar.style.width = isFinite(pct) ? `${pct}%` : "0%";
  }

  function tick() {
    if (!running) return;
    left = Math.max(0, left - 1);
    render();
    if (left === 0) {
      running = false;
      clearInterval(timerId);
      timerId = null;
      restBar.classList.add("bg-success");
      setTimeout(() => restBar.classList.remove("bg-success"), 1500);
    }
  }

  function start() {
    if (running) return;
    if (left <= 0) left = total;
    running = true;
    timerId = setInterval(tick, 1000);
  }

  function pause() {
    running = false;
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function reset() {
    pause();
    total = Number(root.dataset.rest || 60);
    left = total;
    render();
  }

  btnStart.addEventListener("click", (e) => {
    e.preventDefault();
    start();
  });

  btnPause.addEventListener("click", (e) => {
    e.preventDefault();
    pause();
  });

  btnReset.addEventListener("click", (e) => {
    e.preventDefault();
    reset();
  });

  render();
});
