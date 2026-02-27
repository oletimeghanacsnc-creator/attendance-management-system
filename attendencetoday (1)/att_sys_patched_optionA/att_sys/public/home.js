// Helper to get token from localStorage
function getToken() {
  return localStorage.getItem("token");
}

// Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "/";
});

// On load → fetch teacher info and classes
window.addEventListener("DOMContentLoaded", async () => {
  const token = getToken();
  if (!token) {
    alert("Please login first");
    window.location.href = "/";
    return;
  }

  try {
    // Fetch teacher info
    let res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Failed to load profile");
    const me = await res.json();
    document.getElementById("teacherName").innerText = me.name;

    // Fetch classes
    res = await fetch("/api/classes", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Failed to load classes");
    const classes = await res.json();

    const list = document.getElementById("classesList");
    if (classes.length === 0) {
      list.innerHTML = `<p class="text-muted">No classes yet.</p>`;
    } else {
      list.innerHTML = classes.map(
        c => `
          <div class="col-md-4">
            <div class="card shadow-sm">
              <div class="card-body">
                <h5 class="card-title">${c.class_name} - ${c.section}</h5>
                <p class="card-text">
                  <strong>Subject:</strong> ${c.subject_name} (${c.subject_code})<br>
                  <strong>Hours:</strong> ${c.hours}
                </p>
              </div>
            </div>
          </div>
        `
      ).join("");
    }

  } catch (err) {
    console.error(err);
    alert("Error loading data. Please login again.");
    localStorage.removeItem("token");
    window.location.href = "/";
  }
});
