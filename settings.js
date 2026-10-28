import { supabase } from "./supabase.js";

window.NOVA = window.NOVA || {};

const DEFAULT_SETTINGS = {
  theme: "dark",
  notifications_enabled: true,
  message_notifications: true,
  follow_notifications: true,
  email_notifications: false,
  profile_visibility: "public",
  show_online_status: true,
  allow_message_requests: true,
  language: "ar"
};

let currentUser = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let initialized = false;
let loading = false;
let saving = false;
let settingsChannel = null;

const $ = (selector, root = document) =>
  root.querySelector(selector);

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function notify(message, type = "info") {
  if (typeof window.NOVA.toast === "function") {
    window.NOVA.toast(message, type);
    return;
  }

  $("#nova-settings-toast")?.remove();

  const toast = document.createElement("div");

  toast.id = "nova-settings-toast";
  toast.textContent = message;

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "99999",
    background: type === "error" ? "#b42318" : "#17211d",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: "12px",
    maxWidth: "90%",
    textAlign: "center",
    boxShadow: "0 8px 30px #0003"
  });

  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3500);
}

function normalizeSettings(row) {
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  /*
   * يدعم أكثر من شكل محتمل للتخزين:
   * 1) الإعدادات كأعمدة مباشرة.
   * 2) الإعدادات داخل عمود JSON اسمه preferences أو settings.
   *
   * لازم يتوافق الشكل النهائي مع مخطط قاعدة البيانات الحقيقي.
   */
  const nested =
    row.preferences && typeof row.preferences === "object"
      ? row.preferences
      : row.settings && typeof row.settings === "object"
        ? row.settings
        : {};

  return {
    ...DEFAULT_SETTINGS,
    ...nested,
    ...Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS)
        .filter(key => row[key] !== undefined)
        .map(key => [key, row[key]])
    )
  };
}

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";

  document.documentElement.dataset.theme = normalized;
  document.documentElement.setAttribute(
    "data-color-scheme",
    normalized
  );

  document.documentElement.style.colorScheme = normalized;

  const themeColor = document.querySelector(
    'meta[name="theme-color"]'
  );

  if (themeColor) {
    themeColor.content =
      normalized === "dark" ? "#06110d" : "#f5f7f6";
  }

  document.dispatchEvent(
    new CustomEvent("nova:theme-changed", {
      detail: { theme: normalized }
    })
  );
}

function applyLanguage(language) {
  const supportedLanguages = ["ar", "en", "fr"];

  const normalized = supportedLanguages.includes(language)
    ? language
    : "ar";

  document.documentElement.lang = normalized;
  document.documentElement.dir = normalized === "ar" ? "rtl" : "ltr";

  document.dispatchEvent(
    new CustomEvent("nova:language-changed", {
      detail: { language: normalized }
    })
  );
}

function applySettings(settings) {
  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...settings
  };

  applyTheme(currentSettings.theme);
  applyLanguage(currentSettings.language);

  document.dispatchEvent(
    new CustomEvent("nova:settings-applied", {
      detail: { settings: { ...currentSettings } }
    })
  );
}

async function loadSettings() {
  if (!currentUser) {
    currentSettings = { ...DEFAULT_SETTINGS };
    applySettings(currentSettings);
    renderSettings();
    return currentSettings;
  }

  if (loading) return currentSettings;

  loading = true;

  try {
    const { data, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    currentSettings = normalizeSettings(data);
    applySettings(currentSettings);
    renderSettings();

    return currentSettings;
  } catch (error) {
    console.error("NOVA load settings error:", error);

    notify(
      "تعذر تحميل الإعدادات من قاعدة البيانات. تم استخدام الإعدادات الافتراضية.",
      "error"
    );

    applySettings(currentSettings);

    return currentSettings;
  } finally {
    loading = false;
  }
}

function renderSettings() {
  const themeSelect = $("#setting-theme");
  const notificationsToggle = $("#setting-notifications");
  const messageNotificationsToggle = $("#setting-message-notifications");
  const followNotificationsToggle = $("#setting-follow-notifications");
  const emailNotificationsToggle = $("#setting-email-notifications");
  const visibilitySelect = $("#setting-profile-visibility");
  const onlineStatusToggle = $("#setting-online-status");
  const messageRequestsToggle = $("#setting-message-requests");
  const languageSelect = $("#setting-language");

  if (themeSelect) {
    themeSelect.value = currentSettings.theme;
  }

  if (notificationsToggle) {
    notificationsToggle.checked =
      Boolean(currentSettings.notifications_enabled);
  }

  if (messageNotificationsToggle) {
    messageNotificationsToggle.checked =
      Boolean(currentSettings.message_notifications);
  }

  if (followNotificationsToggle) {
    followNotificationsToggle.checked =
      Boolean(currentSettings.follow_notifications);
  }

  if (emailNotificationsToggle) {
    emailNotificationsToggle.checked =
      Boolean(currentSettings.email_notifications);
  }

  if (visibilitySelect) {
    visibilitySelect.value =
      currentSettings.profile_visibility;
  }

  if (onlineStatusToggle) {
    onlineStatusToggle.checked =
      Boolean(currentSettings.show_online_status);
  }

  if (messageRequestsToggle) {
    messageRequestsToggle.checked =
      Boolean(currentSettings.allow_message_requests);
  }

  if (languageSelect) {
    languageSelect.value = currentSettings.language;
  }
}

function readFormSettings() {
  const result = { ...currentSettings };

  const theme = $("#setting-theme");
  const notifications = $("#setting-notifications");
  const messageNotifications = $("#setting-message-notifications");
  const followNotifications = $("#setting-follow-notifications");
  const emailNotifications = $("#setting-email-notifications");
  const visibility = $("#setting-profile-visibility");
  const onlineStatus = $("#setting-online-status");
  const messageRequests = $("#setting-message-requests");
  const language = $("#setting-language");

  if (theme) {
    result.theme = theme.value === "light" ? "light" : "dark";
  }

  if (notifications) {
    result.notifications_enabled = notifications.checked;
  }

  if (messageNotifications) {
    result.message_notifications = messageNotifications.checked;
  }

  if (followNotifications) {
    result.follow_notifications = followNotifications.checked;
  }

  if (emailNotifications) {
    result.email_notifications = emailNotifications.checked;
  }

  if (visibility) {
    const allowed = ["public", "private", "followers"];

    result.profile_visibility = allowed.includes(visibility.value)
      ? visibility.value
      : "public";
  }

  if (onlineStatus) {
    result.show_online_status = onlineStatus.checked;
  }

  if (messageRequests) {
    result.allow_message_requests = messageRequests.checked;
  }

  if (language) {
    const allowedLanguages = ["ar", "en", "fr"];

    result.language = allowedLanguages.includes(language.value)
      ? language.value
      : "ar";
  }

  return result;
}

function buildSettingsPayload(settings) {
  /*
   * افتراضيًا، نتوقع أن تكون إعدادات الحساب أعمدة في الجدول.
   * لو جدولك يخزنها في عمود JSON واحد، غيّر هذه الدالة فقط.
   *
   * لا نرسل id أو created_at أو أعمدة غير معروفة.
   */
  return {
    user_id: currentUser.id,
    theme: settings.theme,
    notifications_enabled: settings.notifications_enabled,
    message_notifications: settings.message_notifications,
    follow_notifications: settings.follow_notifications,
    email_notifications: settings.email_notifications,
    profile_visibility: settings.profile_visibility,
    show_online_status: settings.show_online_status,
    allow_message_requests: settings.allow_message_requests,
    language: settings.language
  };
}

async function saveSettings() {
  if (!currentUser) {
    notify("سجّل الدخول لحفظ إعداداتك.", "error");
    return false;
  }

  if (saving) return false;

  saving = true;

  const saveButton = $("#save-settings-btn");

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "جارٍ الحفظ...";
  }

  const previousSettings = { ...currentSettings };
  const nextSettings = readFormSettings();

  try {
    const payload = buildSettingsPayload(nextSettings);

    /*
     * نحاول تحديث سجل المستخدم أولًا.
     * إذا لم يكن موجودًا، ننشئه باستخدام upsert.
     */
    const { data: updated, error: updateError } = await supabase
      .from("user_settings")
      .upsert(payload, {
        onConflict: "user_id"
      })
      .select("*")
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    currentSettings = normalizeSettings(updated || nextSettings);
    applySettings(currentSettings);
    renderSettings();

    notify("تم حفظ الإعدادات بنجاح.", "success");

    document.dispatchEvent(
      new CustomEvent("nova:settings-saved", {
        detail: { settings: { ...currentSettings } }
      })
    );

    return true;
  } catch (error) {
    console.error("NOVA save settings error:", error);

    currentSettings = previousSettings;
    applySettings(previousSettings);
    renderSettings();

    notify(
      "تعذر حفظ الإعدادات. راجع أعمدة user_settings وسياسات RLS.",
      "error"
    );

    return false;
  } finally {
    saving = false;

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "حفظ الإعدادات";
    }
  }
}

async function updateSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
    throw new Error("إعداد غير معروف.");
  }

  const previous = { ...currentSettings };

  currentSettings = {
    ...currentSettings,
    [key]: value
  };

  applySettings(currentSettings);

  if (!currentUser) {
    renderSettings();
    return true;
  }

  try {
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        buildSettingsPayload(currentSettings),
        { onConflict: "user_id" }
      );

    if (error) throw error;

    renderSettings();

    return true;
  } catch (error) {
    console.error("NOVA update setting error:", error);

    currentSettings = previous;
    applySettings(previous);
    renderSettings();

    notify("تعذر حفظ التغيير.", "error");

    return false;
  }
}

function bindSettingChanges() {
  const changeMap = {
    "#setting-theme": "theme",
    "#setting-notifications": "notifications_enabled",
    "#setting-message-notifications": "message_notifications",
    "#setting-follow-notifications": "follow_notifications",
    "#setting-email-notifications": "email_notifications",
    "#setting-profile-visibility": "profile_visibility",
    "#setting-online-status": "show_online_status",
    "#setting-message-requests": "allow_message_requests",
    "#setting-language": "language"
  };

  for (const [selector, key] of Object.entries(changeMap)) {
    const element = $(selector);

    if (!element) continue;

    element.addEventListener("change", async () => {
      const next = readFormSettings();

      await updateSetting(key, next[key]);
    });
  }
}

async function changePassword() {
  if (!currentUser) {
    notify("سجّل الدخول أولًا.", "error");
    return false;
  }

  const newPassword = $("#setting-new-password")?.value || "";
  const confirmPassword =
    $("#setting-confirm-password")?.value || "";

  if (newPassword.length < 8) {
    notify("كلمة المرور يجب ألا تقل عن 8 أحرف.", "error");
    return false;
  }

  if (newPassword !== confirmPassword) {
    notify("كلمتا المرور غير متطابقتين.", "error");
    return false;
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;

    const passwordInput = $("#setting-new-password");
    const confirmInput = $("#setting-confirm-password");

    if (passwordInput) passwordInput.value = "";
    if (confirmInput) confirmInput.value = "";

    notify("تم تحديث كلمة المرور.", "success");

    return true;
  } catch (error) {
    console.error("NOVA password update error:", error);

    notify(
      error.message || "تعذر تحديث كلمة المرور.",
      "error"
    );

    return false;
  }
}

async function sendPasswordReset() {
  const email = currentUser?.email;

  if (!email) {
    notify(
      "تعذر العثور على البريد الإلكتروني المرتبط بالحساب.",
      "error"
    );

    return false;
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: window.location.origin +
          window.location.pathname
      }
    );

    if (error) throw error;

    notify(
      "لو كان إعداد البريد مفعّلًا، ستصلك رسالة لإعادة تعيين كلمة المرور.",
      "success"
    );

    return true;
  } catch (error) {
    console.error("NOVA password reset error:", error);

    notify(
      error.message || "تعذر إرسال رسالة إعادة التعيين.",
      "error"
    );

    return false;
  }
}

async function signOut() {
  const confirmed = window.confirm(
    "هل أنت متأكد أنك تريد تسجيل الخروج؟"
  );

  if (!confirmed) return false;

  try {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    currentUser = null;
    currentSettings = { ...DEFAULT_SETTINGS };

    applySettings(currentSettings);

    if (settingsChannel) {
      await supabase.removeChannel(settingsChannel);
      settingsChannel = null;
    }

    /*
     * auth.js أو app.js مسؤول عن توجيه المستخدم
     * إلى شاشة تسجيل الدخول بعد انتهاء الجلسة.
     */
    document.dispatchEvent(
      new CustomEvent("nova:signed-out")
    );

    return true;
  } catch (error) {
    console.error("NOVA sign out error:", error);

    notify(
      error.message || "تعذر تسجيل الخروج.",
      "error"
    );

    return false;
  }
}

function bindActions() {
  $("#save-settings-btn")?.addEventListener(
    "click",
    saveSettings
  );

  $("#change-password-btn")?.addEventListener(
    "click",
    changePassword
  );

  $("#reset-password-btn")?.addEventListener(
    "click",
    sendPasswordReset
  );

  $("#logout-btn")?.addEventListener(
    "click",
    signOut
  );

  $("#settings-logout-btn")?.addEventListener(
    "click",
    signOut
  );

  $("#settings-reset-btn")?.addEventListener(
    "click",
    async () => {
      const confirmed = window.confirm(
        "هل تريد استعادة الإعدادات الافتراضية؟"
      );

      if (!confirmed) return;

      currentSettings = { ...DEFAULT_SETTINGS };
      applySettings(currentSettings);
      renderSettings();

      if (currentUser) {
        await saveSettings();
      }
    }
  );
}

function subscribeToSettings() {
  if (!currentUser) return;

  if (settingsChannel) {
    supabase.removeChannel(settingsChannel);
    settingsChannel = null;
  }

  settingsChannel = supabase
    .channel(`nova-settings-${currentUser.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "user_settings",
        filter: `user_id=eq.${currentUser.id}`
      },
      payload => {
        const row = payload.new;

        if (row && row.user_id === currentUser.id) {
          currentSettings = normalizeSettings(row);
          applySettings(currentSettings);
          renderSettings();
        }
      }
    )
    .subscribe();
}

function setUser(user) {
  const changed = currentUser?.id !== user?.id;

  currentUser = user || null;

  if (changed) {
    if (settingsChannel) {
      supabase.removeChannel(settingsChannel);
      settingsChannel = null;
    }

    currentSettings = { ...DEFAULT_SETTINGS };

    if (currentUser && initialized) {
      loadSettings();
      subscribeToSettings();
    } else if (!currentUser) {
      applySettings(currentSettings);
      renderSettings();
    }
  }
}

function initialize(user = null) {
  if (!initialized) {
    bindSettingChanges();
    bindActions();
    initialized = true;
  }

  if (user !== undefined) {
    setUser(user);
  }

  if (currentUser) {
    loadSettings();
    subscribeToSettings();
  } else {
    applySettings(currentSettings);
    renderSettings();
  }

  return {
    loadSettings,
    saveSettings,
    updateSetting,
    changePassword,
    sendPasswordReset,
    signOut
  };
}

window.NOVA.settings = {
  initialize,
  setUser,
  loadSettings,
  saveSettings,
  updateSetting,
  applySettings,
  changePassword,
  sendPasswordReset,
  signOut,
  getSettings: () => ({ ...currentSettings })
};

export {
  initialize,
  setUser,
  loadSettings,
  saveSettings,
  updateSetting,
  applySettings,
  changePassword,
  sendPasswordReset,
  signOut
};
