import { supabase } from "./supabase.js";

import * as Auth from "./auth.js";
import * as Social from "./social.js";
import * as Messages from "./messages.js";
import * as Notifications from "./notifications.js";
import * as Profile from "./profile.js";
import * as Communities from "./communities.js";
import * as Settings from "./settings.js";

window.NOVA = window.NOVA || {};

const NOVA = window.NOVA;

const APP_NAME = "NOVA";

let currentUser = null;
let initialized = false;
let authSubscription = null;
let startupPromise = null;
let authGeneration = 0;
let lastInitializedUserId = null;

const moduleStatus = {
  auth: false,
  social: false,
  messages: false,
  notifications: false,
  profile: false,
  communities: false,
  settings: false
};

const $ = (selector, root = document) =>
  root.querySelector(selector);

function log(...args) {
  console.info(`[${APP_NAME}]`, ...args);
}

function reportError(moduleName, error) {
  console.error(`[${APP_NAME}] ${moduleName}:`, error);
}

function notify(message, type = "info") {
  if (typeof NOVA.toast === "function") {
    NOVA.toast(message, type);
    return;
  }

  let toast = $("#nova-global-toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "nova-global-toast";

    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "12px 18px",
      borderRadius: "12px",
      color: "#fff",
      background: "#17211d",
      boxShadow: "0 8px 30px #0003",
      zIndex: "100000",
      maxWidth: "90%",
      textAlign: "center",
      fontSize: "14px"
    });

    document.body.appendChild(toast);
  }

  toast.style.background =
    type === "error" ? "#b42318" : "#17211d";

  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(toast._timer);

  toast._timer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

function setHidden(selector, hidden) {
  const element = $(selector);

  if (element) {
    element.hidden = hidden;
  }
}

function setText(selector, value) {
  const element = $(selector);

  if (element) {
    element.textContent = value ?? "";
  }
}

function setBusy(busy) {
  document.documentElement.setAttribute(
    "aria-busy",
    busy ? "true" : "false"
  );

  document.body?.classList.toggle(
    "nova-app-loading",
    busy
  );
}

function getElementFromSelectors(selectors) {
  for (const selector of selectors) {
    const element = $(selector);

    if (element) return element;
  }

  return null;
}

/*
 * يحاول العثور على شاشات البداية وتسجيل الدخول والتطبيق
 * دون افتراض أن كل مشروع يستخدم نفس أسماء العناصر.
 */
function getScreens() {
  return {
    loading: getElementFromSelectors([
      "#loading-screen",
      "#splash-screen",
      "#loader-screen"
    ]),

    welcome: getElementFromSelectors([
      "#welcome-screen",
      "#start-screen",
      "#landing-screen"
    ]),

    auth: getElementFromSelectors([
      "#auth-screen",
      "#login-screen",
      "#authentication-screen"
    ]),

    app: getElementFromSelectors([
      "#app-screen",
      "#main-app",
      "#app-container"
    ])
  };
}

function showScreen(screenName) {
  const screens = getScreens();

  const target = screens[screenName];

  if (!target) {
    /*
     * لا نخفي الصفحة كلها إذا كانت أسماء الشاشات مختلفة
     * عن الأسماء المتوقعة؛ فقد يؤدي ذلك إلى شاشة فارغة.
     */
    log(
      `لم يتم العثور على شاشة "${screenName}". راجع IDs في index.html.`
    );

    return false;
  }

  for (const [name, element] of Object.entries(screens)) {
    if (!element) continue;

    element.hidden = name !== screenName;

    element.setAttribute(
      "aria-hidden",
      name === screenName ? "false" : "true"
    );
  }

  document.body.dataset.novaScreen = screenName;

  document.dispatchEvent(
    new CustomEvent("nova:screen-changed", {
      detail: { screen: screenName }
    })
  );

  return true;
}

function showLoadingScreen() {
  const screens = getScreens();

  if (screens.loading) {
    showScreen("loading");
  } else {
    setBusy(true);
  }
}

function showSignedOutScreen() {
  setBusy(false);

  const screens = getScreens();

  if (screens.auth) {
    showScreen("auth");
  } else if (screens.welcome) {
    showScreen("welcome");
  } else {
    /*
     * إذا لم توجد شاشة معروفة، لا نخفي محتوى الصفحة.
     */
    log("أضف شاشة تسجيل الدخول أو البداية إلى index.html.");
  }
}

function showAuthenticatedScreen() {
  setBusy(false);

  const screens = getScreens();

  if (screens.app) {
    showScreen("app");
  } else {
    log(
      "لم يتم العثور على شاشة التطبيق. راجع ID شاشة التطبيق في index.html."
    );
  }
}

/*
 * تهيئة وحدة معزولة حتى لا يؤدي فشل وحدة واحدة
 * إلى إيقاف التطبيق كله.
 */
async function safelyInitialize(name, module, user) {
  try {
    const initialize =
      module?.initialize ||
      module?.default?.initialize;

    const setUser =
      module?.setUser ||
      module?.default?.setUser;

    if (typeof initialize === "function") {
      await initialize(user);
    } else if (typeof setUser === "function") {
      await setUser(user);
    } else {
      log(`وحدة ${name} لا تحتوي على initialize أو setUser.`);
      return false;
    }

    moduleStatus[name] = true;

    return true;
  } catch (error) {
    moduleStatus[name] = false;

    reportError(`تهيئة ${name}`, error);

    return false;
  }
}

/*
 * auth.js قد يستخدم initialize() لربط النماذج.
 * نحاول تهيئته دون الاعتماد على اسم دالة واحدة.
 */
async function initializeAuthModule() {
  try {
    if (typeof Auth.initialize === "function") {
      await Auth.initialize();
    } else if (
      typeof Auth.initAuth === "function"
    ) {
      await Auth.initAuth();
    } else {
      log(
        "لم أجد دالة initialize أو initAuth في auth.js؛ سيتم الاعتماد على جلسة Supabase."
      );
    }

    moduleStatus.auth = true;

    return true;
  } catch (error) {
    moduleStatus.auth = false;

    reportError("تهيئة auth.js", error);

    return false;
  }
}

/*
 * إرسال المستخدم الحالي إلى جميع الوحدات.
 * بعض الوحدات قد تقوم بتحميل بياناتها داخل setUser،
 * لذلك لا نستدعي initialize ثم setUser مرة أخرى بلا داعٍ.
 */
async function initializeUserModules(user, generation) {
  const modules = [
    ["social", Social],
    ["messages", Messages],
    ["notifications", Notifications],
    ["profile", Profile],
    ["communities", Communities],
    ["settings", Settings]
  ];

  const results = await Promise.all(
    modules.map(async ([name, module]) => {
      if (generation !== authGeneration) {
        return [name, false];
      }

      const ok = await safelyInitialize(name, module, user);

      return [name, ok];
    })
  );

  if (generation !== authGeneration) {
    return;
  }

  for (const [name, ok] of results) {
    moduleStatus[name] = ok;
  }

  document.dispatchEvent(
    new CustomEvent("nova:modules-ready", {
      detail: {
        user,
        modules: { ...moduleStatus }
      }
    })
  );
}

function updateUserInterface(user) {
  const isAuthenticated = Boolean(user);

  document.body.classList.toggle(
    "nova-authenticated",
    isAuthenticated
  );

  document.body.classList.toggle(
    "nova-guest",
    !isAuthenticated
  );

  const email = user?.email || "";

  setText("#current-user-email", email);
  setText("#user-email", email);

  const userIdElement = $("#current-user-id");

  if (userIdElement) {
    userIdElement.textContent = user?.id || "";
  }

  const loginButtons = document.querySelectorAll(
    "[data-auth-required]"
  );

  loginButtons.forEach(button => {
    button.disabled = !isAuthenticated;
    button.setAttribute(
      "aria-disabled",
      isAuthenticated ? "false" : "true"
    );
  });

  const authenticatedElements = document.querySelectorAll(
    "[data-show-authenticated]"
  );

  authenticatedElements.forEach(element => {
    element.hidden = !isAuthenticated;
  });

  const guestElements = document.querySelectorAll(
    "[data-show-guest]"
  );

  guestElements.forEach(element => {
    element.hidden = isAuthenticated;
  });

  document.dispatchEvent(
    new CustomEvent("nova:user-interface-updated", {
      detail: {
        user,
        authenticated: isAuthenticated
      }
    })
  );
}

/*
 * نقطة الدخول الموحدة لحالة المستخدم.
 */
async function handleAuthState(user, options = {}) {
  const generation = ++authGeneration;

  const nextUser = user || null;
  const nextUserId = nextUser?.id || null;

  const userChanged = lastInitializedUserId !== nextUserId;

  currentUser = nextUser;

  NOVA.currentUser = nextUser;
  NOVA.user = nextUser;

  updateUserInterface(nextUser);

  if (!nextUser) {
    lastInitializedUserId = null;

    /*
     * إبلاغ جميع الوحدات بانتهاء الجلسة.
     */
    const modules = [
      Social,
      Messages,
      Notifications,
      Profile,
      Communities,
      Settings
    ];

    for (const module of modules) {
      try {
        if (typeof module.setUser === "function") {
          await module.setUser(null);
        }
      } catch (error) {
        reportError("إنهاء جلسة وحدة", error);
      }
    }

    showSignedOutScreen();

    document.dispatchEvent(
      new CustomEvent("nova:auth-state-changed", {
        detail: {
          user: null,
          authenticated: false,
          source: options.source || "unknown"
        }
      })
    );

    return null;
  }

  /*
   * لا نكرر تحميل كل الوحدات إذا وصلت حالة الجلسة
   * نفسها أكثر من مرة.
   */
  if (!userChanged && lastInitializedUserId === nextUserId) {
    showAuthenticatedScreen();

    document.dispatchEvent(
      new CustomEvent("nova:auth-state-changed", {
        detail: {
          user: nextUser,
          authenticated: true,
          source: options.source || "unknown"
        }
      })
    );

    return nextUser;
  }

  lastInitializedUserId = nextUserId;

  showAuthenticatedScreen();

  await initializeUserModules(nextUser, generation);

  if (generation !== authGeneration) {
    return null;
  }

  document.dispatchEvent(
    new CustomEvent("nova:auth-state-changed", {
      detail: {
        user: nextUser,
        authenticated: true,
        source: options.source || "unknown"
      }
    })
  );

  log("تم تجهيز جلسة المستخدم.");

  return nextUser;
}

/*
 * تحميل الجلسة الحالية من Supabase.
 * لا يوجد تسجيل دخول وهمي ولا مستخدم تجريبي.
 */
async function restoreSession() {
  showLoadingScreen();

  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    const user = data?.session?.user || null;

    await handleAuthState(user, {
      source: "restore-session"
    });

    return user;
  } catch (error) {
    reportError("استعادة الجلسة", error);

    showSignedOutScreen();

    notify(
      "تعذر التحقق من جلسة الدخول. حاول تحديث الصفحة.",
      "error"
    );

    return null;
  }
}

function subscribeToAuthChanges() {
  if (authSubscription) {
    authSubscription.unsubscribe();
    authSubscription = null;
  }

  const { data } = supabase.auth.onAuthStateChange(
    (event, session) => {
      /*
       * نتجنب العمليات الثقيلة مباشرة داخل callback
       * الخاص بمصادقة Supabase.
       */
      queueMicrotask(() => {
        const user = session?.user || null;

        handleAuthState(user, {
          source: event
        }).catch(error => {
          reportError("تحديث حالة المصادقة", error);
        });
      });
    }
  );

  authSubscription = data?.subscription || null;
}

function bindNavigation() {
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-nova-page]");

    if (!button) return;

    const page = button.dataset.novaPage;

    if (!page) return;

    event.preventDefault();

    openPage(page);
  });
}

function openPage(page) {
  const pageMap = {
    home: ["#home-page", "#feed-page", "#feed-view"],
    feed: ["#feed-page", "#feed-view", "#home-page"],
    messages: ["#messages-page", "#messages-view", "#chat-page"],
    notifications: [
      "#notifications-page",
      "#notifications-view"
    ],
    profile: ["#profile-page", "#profile-view"],
    communities: [
      "#communities-page",
      "#communities-view"
    ],
    settings: ["#settings-page", "#settings-view"],
    search: ["#search-page", "#search-view"]
  };

  const selectors = pageMap[page];

  if (!selectors) {
    log(`الصفحة "${page}" غير مسجلة في خريطة التنقل.`);
    return false;
  }

  const target = getElementFromSelectors(selectors);

  if (!target) {
    log(
      `لم يتم العثور على عنصر HTML لصفحة "${page}".`
    );

    return false;
  }

  const pages = document.querySelectorAll(
    "[data-nova-page-view]"
  );

  if (pages.length) {
    pages.forEach(element => {
      const active = element === target;

      element.hidden = !active;

      element.setAttribute(
        "aria-hidden",
        active ? "false" : "true"
      );
    });
  } else {
    /*
     * لا نخفي عناصر عشوائية إذا لم يكن المشروع يستخدم
     * data-nova-page-view.
     */
    target.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  document.body.dataset.novaPage = page;

  document.dispatchEvent(
    new CustomEvent("nova:navigate", {
      detail: { page }
    })
  );

  if (page === "profile" && currentUser) {
    Profile.load?.(currentUser.id);
  }

  if (page === "communities" && currentUser) {
    Communities.loadCommunities?.();
    Communities.loadMyCommunities?.();
  }

  if (page === "notifications" && currentUser) {
    Notifications.load?.();
  }

  if (page === "messages" && currentUser) {
    Messages.loadConversations?.();
  }

  return true;
}

function bindGlobalActions() {
  $("#nova-retry-app")?.addEventListener(
    "click",
    () => restoreSession()
  );

  $("#nova-refresh-app")?.addEventListener(
    "click",
    () => window.location.reload()
  );

  $("#nova-open-home")?.addEventListener(
    "click",
    () => openPage("home")
  );

  $("#nova-open-profile")?.addEventListener(
    "click",
    () => openPage("profile")
  );

  $("#nova-open-messages")?.addEventListener(
    "click",
    () => openPage("messages")
  );

  $("#nova-open-notifications")?.addEventListener(
    "click",
    () => openPage("notifications")
  );

  $("#nova-open-communities")?.addEventListener(
    "click",
    () => openPage("communities")
  );

  $("#nova-open-settings")?.addEventListener(
    "click",
    () => openPage("settings")
  );
}

function setupGlobalErrorHandlers() {
  window.addEventListener("unhandledrejection", event => {
    console.error(
      "[NOVA] خطأ غير معالج في Promise:",
      event.reason
    );
  });

  window.addEventListener("error", event => {
    console.error(
      "[NOVA] خطأ JavaScript:",
      event.error || event.message
    );
  });
}

async function initialize() {
  if (initialized) {
    return startupPromise;
  }

  initialized = true;

  setBusy(true);

  setupGlobalErrorHandlers();
  bindNavigation();
  bindGlobalActions();

  await initializeAuthModule();

  /*
   * اشترك في تغييرات الجلسة قبل استعادة الجلسة الحالية،
   * حتى نلتقط تسجيل الدخول أو الخروج اللاحق.
   */
  subscribeToAuthChanges();

  startupPromise = restoreSession();

  await startupPromise;

  setBusy(false);

  document.dispatchEvent(
    new CustomEvent("nova:app-ready", {
      detail: {
        app: APP_NAME,
        user: currentUser,
        modules: { ...moduleStatus }
      }
    })
  );

  log("اكتملت مرحلة بدء التطبيق.");

  return currentUser;
}

function destroy() {
  if (authSubscription) {
    authSubscription.unsubscribe();
    authSubscription = null;
  }

  currentUser = null;
  lastInitializedUserId = null;
  initialized = false;
  startupPromise = null;

  NOVA.currentUser = null;
  NOVA.user = null;

  log("تم إيقاف مراقبة جلسة التطبيق.");
}

function getState() {
  return {
    initialized,
    authenticated: Boolean(currentUser),
    user: currentUser,
    modules: { ...moduleStatus }
  };
}

/*
 * واجهة عامة لبقية الملفات ولأدوات المطور.
 */
NOVA.app = {
  initialize,
  restoreSession,
  handleAuthState,
  openPage,
  showScreen,
  signOut: () => Settings.signOut?.(),
  destroy,
  getState,
  getCurrentUser: () => currentUser
};

export {
  initialize,
  restoreSession,
  handleAuthState,
  openPage,
  showScreen,
  destroy,
  getState
};

/*
 * التشغيل التلقائي عند اكتمال تحميل HTML.
 */
if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initialize().catch(error => {
        reportError("بدء التطبيق", error);
        showSignedOutScreen();
      });
    },
    { once: true }
  );
} else {
  initialize().catch(error => {
    reportError("بدء التطبيق", error);
    showSignedOutScreen();
  });
}
