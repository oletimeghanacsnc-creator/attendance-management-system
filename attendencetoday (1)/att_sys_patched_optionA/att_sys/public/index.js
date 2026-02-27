// index.js
document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");

  if (token) {
    // Redirect to teacher dashboard if logged in
    window.location.href = "/home.html";
  }

  // Buttons are <a>, but ensure redirection
  const registerBtn = document.querySelector('a[href="/register.html"]');
  const loginBtn = document.querySelector('a[href="/login.html"]');

  if (registerBtn) {
    registerBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "/register.html";
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "/login.html";
    });
  }
});
