(() => {
  const telegram = window.Telegram?.WebApp;
  const API_URL = "https://rottenes-preorder-api.onrender.com/api/order";
  if (telegram) {
    telegram.ready();
    telegram.expand();
    telegram.setHeaderColor?.("#050505");
    telegram.setBackgroundColor?.("#050505");
  }

  const slides = [...document.querySelectorAll(".slide")];
  const counter = document.querySelector("#gallery-count");
  const gallery = document.querySelector("#gallery");
  let currentSlide = 0;

  slides.forEach(slide => {
    const image = slide.querySelector("img");
    const match = image.getAttribute("src").match(/^(.*)\.(jpg|jpeg|png|webp)$/i);
    if (!match) return;
    const basePath = match[1];
    const formats = [match[2].toLowerCase(), "png", "jpg", "jpeg", "webp"]
      .filter((format, index, all) => all.indexOf(format) === index);
    let nextFormat = 1;
    image.addEventListener("error", () => {
      if (nextFormat < formats.length) image.src = basePath + "." + formats[nextFormat++];
      else {
        image.classList.add("image-missing");
        slide.classList.add("is-missing");
      }
    });
  });

  function showSlide(index) {
    currentSlide = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === currentSlide));
    counter.textContent = String(currentSlide + 1).padStart(2, "0") + " / " + String(slides.length).padStart(2, "0");
  }
  document.querySelector("#previous").addEventListener("click", () => {
    showSlide(currentSlide - 1);
    telegram?.HapticFeedback?.selectionChanged();
  });
  document.querySelector("#next").addEventListener("click", () => {
    showSlide(currentSlide + 1);
    telegram?.HapticFeedback?.selectionChanged();
  });

  let touchStartX = 0;
  gallery.addEventListener("touchstart", event => { touchStartX = event.changedTouches[0].screenX; }, { passive: true });
  gallery.addEventListener("touchend", event => {
    const distance = event.changedTouches[0].screenX - touchStartX;
    if (Math.abs(distance) > 45) showSlide(currentSlide + (distance < 0 ? 1 : -1));
  }, { passive: true });

  const modal = document.querySelector("#order-modal");
  const form = document.querySelector("#order-form");
  const toast = document.querySelector("#toast");
  let toastTimer;
  function openModal() {
    const username = telegram?.initDataUnsafe?.user?.username;
    if (username && !document.querySelector("#tg-username").value) document.querySelector("#tg-username").value = "@" + username;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    telegram?.HapticFeedback?.impactOccurred("light");
    setTimeout(() => document.querySelector("#tg-username").focus(), 120);
  }
  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }
  document.querySelector("#preorder").addEventListener("click", openModal);
  document.querySelector("#modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) closeModal();
  });

  const cityInput = document.querySelector("#city");
  const mapSearchLabel = document.querySelector("#map-search-label");
  cityInput.addEventListener("input", () => {
    const city = cityInput.value.trim();
    mapSearchLabel.textContent = city ? "Пункты СДЭК · " + city : "Показать пункты СДЭК на карте";
  });
  document.querySelector("#map-search").addEventListener("click", () => {
    const city = cityInput.value.trim();
    if (!city) { cityInput.focus(); cityInput.reportValidity(); return; }
    const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("пункты выдачи СДЭК " + city);
    if (telegram?.openLink) telegram.openLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  });

  function showToast(message, duration = 3000) {
    clearTimeout(toastTimer);
    toast.classList.remove("show");
    toast.textContent = message;
    void toast.offsetWidth;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const username = document.querySelector("#tg-username").value.trim();
    const phone = document.querySelector("#phone").value.trim();
    if (!username.startsWith("@") || username.length < 2) { showToast("Telegram username должен начинаться с @"); return; }
    if (!/^\+7[0-9]{10}$/.test(phone)) { showToast("Номер телефона должен начинаться на +7"); return; }
    const emptyField = [...form.querySelectorAll("[required]")].find(field => !field.value.trim());
    if (emptyField) { showToast("Заполни, пожалуйста, все поля"); emptyField.focus(); return; }
    if (!telegram?.initData) { showToast("Открой приложение через Telegram, чтобы отправить заявку", 4500); return; }
    const submitButton = form.querySelector('[type="submit"]');
    const previousLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Отправляем…";
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": telegram.initData },
        body: JSON.stringify({
          username,
          phone,
          fullName: document.querySelector("#full-name").value.trim(),
          city: cityInput.value.trim(),
          pickupAddress: document.querySelector("#pickup-address").value.trim()
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось отправить заявку. Попробуй ещё раз");
      telegram.HapticFeedback?.notificationOccurred("success");
      closeModal();
      form.reset();
      mapSearchLabel.textContent = "Показать пункты СДЭК на карте";
      showToast("Заявка отправлена. Спасибо!", 3500);
    } catch (error) {
      showToast(error.message || "Не удалось связаться с сервером. Попробуй позже", 4500);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = previousLabel;
    }
  });
})();
