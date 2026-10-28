/* =========================================
   NOVA SOCIAL
   File: auth.js
   Authentication services and UI
========================================= */

import {
  supabase,
  getCurrentSession,
  subscribeToAuthChanges
} from "./supabase.js";

let authInitialized = false;
let authSubscription = null;
let authBusy = false;

const $ = (selector) => document.querySelector(selector);

function showMessage(elementId, message, isError = false) {
  const element = document.getElementById(elementId);

  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden", "error");

  if (isError) {
    element.classList.add("error");
  }
}

function clearMessage(elementId) {
  const element = document.getElementById(elementId);

  if (!element) return;

  element.textContent = "";
  element.classList.add("hidden");
  element.classList.remove("error");
}

function normalizeUsername(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
}

function validateUsername(username) {
  return /^[a-z0-9_]{3,30}$/.test(username);
}

function friendlyAuthError(error) {
  const message = String(error?.message ?? "").toLowerCase();

  if (
    message.includes("invalid login credentials") ||
    message.includes("invalid credentials")
  ) {
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  }

  if (message.includes("email not confirmed")) {
    return "يجب تأكيد بريدك الإلكتروني أولًا. راجع صندوق الوارد.";
  }

  if (
    message.includes("user already registered") ||
    message.includes("already registered")
  ) {
    return "هذا البريد الإلكتروني مسجل بالفعل. حاول تسجيل الدخول.";
  }

  if (message.includes("password")) {
    return "تعذر استخدام كلمة المرور. تأكد من أنها تحقق شروط التسجيل.";
  }

  if (
    message.includes("network") ||
    message.includes("fetch")
  ) {
    return "تعذر الاتصال بالخادم. تأكد من اتصال الإنترنت وحاول مجددًا.";
  }

  if (message.includes("rate limit")) {
    return "تم إجراء طلبات كثيرة في وقت قصير. انتظر قليلًا ثم حاول مجددًا.";
  }

  return error?.message || "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

function setSubmitState(form, busy, busyLabel = "جارٍ التنفيذ...") {
  if (!form) return;

  const button = form.querySelector('button[type="submit"]');

  if (!button) return;

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML =
      `<i class="fa-solid fa-spinner fa-spin"></i> ${busyLabel}`;
  } else {
    button.disabled = false;

    if (button.dataset.originalText) {
      button.innerHTML = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

function displayAuthScreen() {
  $("#auth-screen")?.classList.remove("hidden");
  $("#app-screen")?.classList.add("hidden");
}

function displayAppScreen() {
  $("#auth-screen")?.classList.add("hidden");
  $("#app-screen")?.classList.remove("hidden");
}

function showAuthForm(formName) {
  const forms = {
    login: "#login-form-container",
    register: "#register-form-container",
    reset: "#reset-form-container"
  };

  Object.values(forms).forEach((selector) => {
    $(selector)?.classList.add("hidden");
  });

  $(forms[formName])?.classList.remove("hidden");

  [
    "login-message",
    "register-message",
    "reset-message"
  ].forEach(clearMessage);
}

async function handleLogin(event) {
  event.preventDefault();

  if (authBusy) return;

  const form = event.currentTarget;
  const email = $("#login-email")?.value.trim();
  const password = $("#login-password")?.value;

  clearMessage("login-message");

  if (!email || !password) {
    showMessage(
      "login-message",
      "أدخل البريد الإلكتروني وكلمة المرور.",
      true
    );
    return;
  }

  authBusy = true;
  setSubmitState(form, true, "جارٍ تسجيل الدخول...");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    if (!data.user) {
      throw new Error("لم يتم إرجاع بيانات المستخدم.");
    }

    showMessage(
      "login-message",
      "تم تسجيل الدخول بنجاح. جارٍ فتح حسابك..."
    );

    displayAppScreen();

    if (typeof window.NOVA?.onAuthenticated === "function") {
      await window.NOVA.onAuthenticated(data.user);
    }
  } catch (error) {
    showMessage(
      "login-message",
      friendlyAuthError(error),
      true
    );
  } finally {
    authBusy = false;
    setSubmitState(form, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();

  if (authBusy) return;

  const form = event.currentTarget;

  const fullName = $("#register-name")?.value.trim();
  const username = normalizeUsername($("#register-username")?.value);
  const email = $("#register-email")?.value.trim();
  const password = $("#register-password")?.value;

  clearMessage("register-message");

  if (!fullName || fullName.length < 2) {
    showMessage(
      "register-message",
      "اكتب اسمًا صحيحًا يتكون من حرفين على الأقل.",
      true
    );
    return;
  }

  if (!validateUsername(username)) {
    showMessage(
      "register-message",
      "اسم المستخدم يجب أن يتكون من 3 إلى 30 حرفًا إنجليزيًا صغيرًا أو رقمًا أو شرطة سفلية.",
      true
    );
    return;
  }

  if (!email) {
    showMessage(
      "register-message",
      "أدخل بريدًا إلكترونيًا صحيحًا.",
      true
    );
    return;
  }

  if (!password || password.length < 8) {
    showMessage(
      "register-message",
      "كلمة المرور يجب ألا تقل عن 8 أحرف.",
      true
    );
    return;
  }

  authBusy = true;
  setSubmitState(form, true, "جارٍ إنشاء الحساب...");

  try {
    /*
      نمرر بيانات الاسم واسم المستخدم ضمن user_metadata.
      إنشاء صف profile الأساسي يعتمد على trigger الموجود
      في قاعدة البيانات. لا ننشئ جدولًا جديدًا هنا.
    */

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          username
        },
        emailRedirectTo: window.location.origin +
          window.location.pathname
      }
    });

    if (error) throw error;

    if (data.session && data.user) {
      showMessage(
        "register-message",
        "تم إنشاء حسابك بنجاح. جارٍ فتح المنصة..."
      );

      displayAppScreen();

      if (typeof window.NOVA?.onAuthenticated === "function") {
        await window.NOVA.onAuthenticated(data.user);
      }
    } else {
      showMessage(
        "register-message",
        "تم إرسال طلب التسجيل. إذا كان تأكيد البريد الإلكتروني مفعّلًا، افتح رسالة التأكيد ثم سجّل الدخول."
      );
    }
  } catch (error) {
    showMessage(
      "register-message",
      friendlyAuthError(error),
      true
    );
  } finally {
    authBusy = false;
    setSubmitState(form, false);
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();

  if (authBusy) return;

  const form = event.currentTarget;
  const email = $("#reset-email")?.value.trim();

  clearMessage("reset-message");

  if (!email) {
    showMessage(
      "reset-message",
      "أدخل البريد الإلكتروني أولًا.",
      true
    );
    return;
  }

  authBusy = true;
  setSubmitState(form, true, "جارٍ الإرسال...");

  try {
    const redirectTo = new URL(
      window.location.pathname,
      window.location.origin
    ).href;

    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo
      }
    );

    if (error) throw error;

    showMessage(
      "reset-message",
      "إذا كان البريد مرتبطًا بحساب، فستصلك رسالة لاستعادة كلمة المرور. راجع صندوق الوارد والبريد غير المرغوب فيه."
    );
  } catch (error) {
    showMessage(
      "reset-message",
      friendlyAuthError(error),
      true
    );
  } finally {
    authBusy = false;
    setSubmitState(form, false);
  }
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    displayAuthScreen();
    showAuthForm("login");

    if (typeof window.NOVA?.onSignedOut === "function") {
      await window.NOVA.onSignedOut();
    }

    return { error: null };
  } catch (error) {
    if (typeof window.NOVA?.toast === "function") {
      window.NOVA.toast(
        friendlyAuthError(error),
        "error"
      );
    }

    return { error };
  }
}

export async function initializeAuth() {
  if (authInitialized) {
    return getCurrentSession();
  }

  authInitialized = true;

  $("#login-form")?.addEventListener("submit", handleLogin);
  $("#register-form")?.addEventListener("submit", handleRegister);
  $("#reset-form")?.addEventListener("submit", handlePasswordReset);

  $("#show-register-btn")?.addEventListener("click", () => {
    showAuthForm("register");
  });

  $("#show-login-btn")?.addEventListener("click", () => {
    showAuthForm("login");
  });

  $("#forgot-password-btn")?.addEventListener("click", () => {
    $("#reset-email").value = $("#login-email")?.value.trim() || "";
    showAuthForm("reset");
  });

  $("#reset-back-btn")?.addEventListener("click", () => {
    showAuthForm("login");
  });

  $("#logout-btn")?.addEventListener("click", signOut);
  $("#settings-logout")?.addEventListener("click", signOut);

  try {
    const { session, error } = await getCurrentSession();

    if (error) throw error;

    if (session?.user) {
      displayAppScreen();

      if (typeof window.NOVA?.onAuthenticated === "function") {
        await window.NOVA.onAuthenticated(session.user);
      }
    } else {
      displayAuthScreen();
      showAuthForm("login");
    }
  } catch (error) {
    console.error("NOVA auth initialization failed:", error);

    displayAuthScreen();

    showMessage(
      "login-message",
      "تعذر التحقق من جلسة الدخول. تأكد من الاتصال بالإنترنت ثم حاول مجددًا.",
      true
    );
  }

  if (!authSubscription) {
    authSubscription = subscribeToAuthChanges(
      async (event, session) => {
        if (event === "SIGNED_OUT" || !session?.user) {
          displayAuthScreen();
          showAuthForm("login");
          return;
        }

        if (
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "USER_UPDATED"
        ) {
          displayAppScreen();

          if (typeof window.NOVA?.onAuthenticated === "function") {
            await window.NOVA.onAuthenticated(session.user);
          }
        }
      }
    );
  }

  return getCurrentSession();
}

export function getAuthErrorMessage(error) {
  return friendlyAuthError(error);
}
