const form = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');

form.addEventListener('submit', function (e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  errorMsg.classList.add('hidden');

  if (username === 'admin' && password === '12345') {
    alert('Login berhasil!');
  } else {
    errorMsg.classList.remove('hidden');
  }
});
