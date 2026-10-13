(() => {
  const telegram = window.Telegram?.WebApp;
  const API_BASE = "https://rottenes-preorder-api.onrender.com";
  const API_URL = API_BASE + "/api/order";
  if (telegram) { telegram.ready(); telegram.expand(); telegram.setHeaderColor?.("#050505"); telegram.setBackgroundColor?.("#050505"); }

  const slides = [...document.querySelectorAll(".slide")];
  const counter = document.querySelector("#gallery-count");
  const gallery = document.querySelector("#gallery");
  let currentSlide = 0;
  slides.forEach(slide => {
    const image = slide.querySelector("img");
    const match = image.getAttribute("src").match(/^(.*)\.(jpg|jpeg|png|webp)$/i);
    if (!match) return;
    const base = match[1], formats = [...new Set([match[2].toLowerCase(), "png", "jpg", "jpeg", "webp"])];
    let next = 1;
    image.addEventListener("error", () => {
      if (next < formats.length) image.src = base + "." + formats[next++];
      else { image.classList.add("image-missing"); slide.classList.add("is-missing"); }
    });
  });
  function showSlide(index) {
    currentSlide = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("active", i === currentSlide));
    counter.textContent = String(currentSlide + 1).padStart(2, "0") + " / " + String(slides.length).padStart(2, "0");
  }
  document.querySelector("#previous").addEventListener("click", () => { showSlide(currentSlide - 1); telegram?.HapticFeedback?.selectionChanged(); });
  document.querySelector("#next").addEventListener("click", () => { showSlide(currentSlide + 1); telegram?.HapticFeedback?.selectionChanged(); });
  let touchStartX = 0;
  gallery.addEventListener("touchstart", e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  gallery.addEventListener("touchend", e => { const d = e.changedTouches[0].screenX - touchStartX; if (Math.abs(d) > 45) showSlide(currentSlide + (d < 0 ? 1 : -1)); }, { passive: true });

  const orderModal = document.querySelector("#order-modal"), orderForm = document.querySelector("#order-form");
  const authModal = document.querySelector("#auth-modal"), authForm = document.querySelector("#auth-form");
  const toast = document.querySelector("#toast"), authFeedback = document.querySelector("#auth-feedback");
  const authEmail = document.querySelector("#auth-email"), authPassword = document.querySelector("#auth-password");
  const emailLabel = document.querySelector('label[for="auth-email"]');
  const passwordLabel = document.querySelector('label[for="auth-password"]');
  const authTitle = document.querySelector("#auth-title"), authDescription = document.querySelector("#auth-description");
  const authSubmit = document.querySelector("#auth-submit"), authSwitch = document.querySelector("#auth-switch");
  const authForgot = document.querySelector("#auth-forgot");
  const cityInput = document.querySelector("#city"), mapLabel = document.querySelector("#map-search-label");
  const accountStrip = document.querySelector("#account-strip"), accountEmail = document.querySelector("#account-email");
  let toastTimer, supabase, session = null, accountsEnabled = false, authMode = "login";

  function showToast(message, duration = 3200) {
    clearTimeout(toastTimer); toast.classList.remove("show"); toast.textContent = message;
    void toast.offsetWidth; toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
  }
  function open(modal) { modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false"); document.body.classList.add("modal-open"); }
  function close(modal) {
    modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true");
    if (![orderModal, authModal].some(m => m.classList.contains("is-open"))) document.body.classList.remove("modal-open");
  }
  function renderSession(value) {
    session = value; accountStrip.hidden = !(accountsEnabled && session);
    accountEmail.textContent = session?.user?.email || "";
  }
  function setAuthView(mode) {
    authMode = mode;
    const signup = mode === "signup", passwordUpdate = mode === "passwordUpdate";
    emailLabel.hidden = passwordUpdate; authEmail.hidden = passwordUpdate;
    authEmail.disabled = passwordUpdate; authEmail.required = !passwordUpdate;
    passwordLabel.hidden = false; authPassword.hidden = false;
    authPassword.disabled = false; authPassword.required = true; authPassword.minLength = 8;
    authPassword.autocomplete = signup || passwordUpdate ? "new-password" : "current-password";
    authPassword.placeholder = passwordUpdate ? "Новый пароль" : "Не менее 8 символов";
    authTitle.textContent = passwordUpdate ? "Новый пароль" : signup ? "Создать аккаунт" : "Войти в аккаунт";
    authDescription.textContent = passwordUpdate ? "Придумай новый пароль для своего аккаунта." : signup ? "Укажи почту и придумай пароль для аккаунта." : "Войди, чтобы оформить предзаказ.";
    authSubmit.innerHTML = (passwordUpdate ? "Сохранить пароль" : signup ? "Зарегистрироваться" : "Войти") + " <span>↗</span>";
    authSwitch.hidden = passwordUpdate; authForgot.hidden = signup || passwordUpdate;
    authSwitch.textContent = signup ? "Уже есть аккаунт? Войти" : "Создать аккаунт";
    authFeedback.textContent = "";
  }
  function openAuth() { setAuthView("login"); open(authModal); setTimeout(() => authEmail.focus(), 120); }
  function startPasswordUpdate() { setAuthView("passwordUpdate"); open(authModal); setTimeout(() => authPassword.focus(), 120); }

  document.querySelector("#preorder").addEventListener("click", () => {
    telegram?.HapticFeedback?.impactOccurred("light");
    if (accountsEnabled && !session) { openAuth(); return; }
    const name = telegram?.initDataUnsafe?.user?.username;
    if (name && !document.querySelector("#tg-username").value) document.querySelector("#tg-username").value = "@" + name;
    open(orderModal); setTimeout(() => document.querySelector("#tg-username").focus(), 120);
  });
  document.querySelector("#modal-close").addEventListener("click", () => close(orderModal));
  document.querySelector("#auth-close").addEventListener("click", () => close(authModal));
  [orderModal, authModal].forEach(modal => modal.addEventListener("click", e => { if (e.target === modal) close(modal); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") { close(orderModal); close(authModal); } });

  authSwitch.addEventListener("click", () => setAuthView(authMode === "login" ? "signup" : "login"));
  authForgot.addEventListener("click", async () => {
    if (!supabase) { authFeedback.textContent = "Подключение аккаунтов ещё не настроено."; return; }
    if (!authEmail.value.trim()) { authFeedback.textContent = "Сначала введи адрес электронной почты."; authEmail.focus(); return; }
    const oldText = authForgot.textContent;
    authForgot.disabled = true; authForgot.textContent = "Отправляем письмо…"; authFeedback.textContent = "";
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authEmail.value.trim(), { redirectTo: location.origin });
      if (error) throw error;
      authFeedback.textContent = "Если аккаунт с этой почтой существует, письмо для смены пароля отправлено.";
    } catch (error) { authFeedback.textContent = error.message || "Не удалось отправить письмо. Попробуй позже."; }
    finally { authForgot.disabled = false; authForgot.textContent = oldText; }
  });
  authForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (!supabase) { authFeedback.textContent = "Подключение аккаунтов ещё не настроено."; return; }
    authSubmit.disabled = true; authSubmit.textContent = "Подождите…"; authFeedback.textContent = "";
    const email = authEmail.value.trim(), password = authPassword.value;
    try {
      if (authMode === "passwordUpdate") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        close(authModal); setAuthView("login"); authForm.reset(); showToast("Пароль изменён. Теперь можно войти.");
      } else if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) { authFeedback.textContent = "Аккаунт создан. Проверь почту и подтверди адрес, затем войди."; return; }
        renderSession(data.session); close(authModal); showToast("Аккаунт создан. Теперь можно оформить предзаказ.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        renderSession(data.session); close(authModal); showToast("Вход выполнен.");
      }
    } catch (error) { authFeedback.textContent = error.message || "Не удалось выполнить действие. Проверь данные."; }
    finally {
      authSubmit.disabled = false;
      authSubmit.innerHTML = (authMode === "passwordUpdate" ? "Сохранить пароль" : authMode === "signup" ? "Зарегистрироваться" : "Войти") + " <span>↗</span>";
    }
  });
  document.querySelector("#logout").addEventListener("click", async () => { await supabase?.auth.signOut(); renderSession(null); showToast("Ты вышел из аккаунта."); });

  cityInput.addEventListener("input", () => { const city = cityInput.value.trim(); mapLabel.textContent = city ? "Пункты СДЭК · " + city : "Показать пункты СДЭК на карте"; });
  document.querySelector("#map-search").addEventListener("click", () => {
    const city = cityInput.value.trim(); if (!city) { cityInput.focus(); cityInput.reportValidity(); return; }
    const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("пункты выдачи СДЭК " + city);
    if (telegram?.openLink) telegram.openLink(url); else window.open(url, "_blank", "noopener,noreferrer");
  });
  orderForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (accountsEnabled && !session) { close(orderModal); openAuth(); return; }
    const username = document.querySelector("#tg-username").value.trim(), phone = document.querySelector("#phone").value.trim();
    if (!username.startsWith("@") || username.length < 2) { showToast("Telegram username должен начинаться с @"); return; }
    if (!/^\+7[0-9]{10}$/.test(phone)) { showToast("Номер телефона должен начинаться на +7"); return; }
    const empty = [...orderForm.querySelectorAll("[required]")].find(field => !field.value.trim());
    if (empty) { showToast("Заполни, пожалуйста, все поля"); empty.focus(); return; }
    if (!accountsEnabled && !telegram?.initData) { showToast("Открой приложение через Telegram, чтобы отправить заявку", 4500); return; }
    const button = orderForm.querySelector('[type="submit"]'), oldText = button.textContent;
    button.disabled = true; button.textContent = "Отправляем…";
    try {
      const headers = { "Content-Type": "application/json" };
      if (accountsEnabled) headers.Authorization = "Bearer " + session.access_token;
      else headers["X-Telegram-Init-Data"] = telegram.initData;
      const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ username, phone, fullName: document.querySelector("#full-name").value.trim(), city: cityInput.value.trim(), pickupAddress: document.querySelector("#pickup-address").value.trim() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось отправить заявку. Попробуй ещё раз");
      telegram?.HapticFeedback?.notificationOccurred("success"); close(orderModal); orderForm.reset();
      mapLabel.textContent = "Показать пункты СДЭК на карте"; showToast("Заявка отправлена. Спасибо!", 3500);
    } catch (error) { showToast(error.message || "Не удалось связаться с сервером. Попробуй позже", 4500); }
    finally { button.disabled = false; button.textContent = oldText; }
  });

  fetch(API_BASE + "/api/config").then(r => r.json()).then(async config => {
    accountsEnabled = Boolean(config.accountsEnabled && config.supabaseUrl && config.supabaseAnonKey);
    if (accountsEnabled) {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
      supabase.auth.onAuthStateChange((event, nextSession) => {
        renderSession(nextSession);
        if (event === "PASSWORD_RECOVERY") startPasswordUpdate();
      });
      const { data } = await supabase.auth.getSession(); renderSession(data.session);
    }
  }).catch(() => { accountsEnabled = false; });
})();
