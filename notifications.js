import { supabase } from "./supabase.js";

const NOTIFICATIONS_LIMIT = 50;

let currentUser = null;
let notificationChannel = null;
let initialized = false;
let loading = false;

const notificationState = {
  items: [],
  unreadCount: 0
};

function el(selector) {
  return document.querySelector(selector);
}

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
  if (typeof window.NOVA?.toast === "function") {
    window.NOVA.toast(message, type);
    return;
  }

  const container = el("#toast-container");

  if (!container) {
    console.info("[NOVA Notifications]", message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `nova-toast ${type}`;
  toast.textContent = message;
  toast.setAttribute("role", "status");

  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3500);
}

function formatTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  try {
    return new Intl.RelativeTimeFormat("ar", {
      numeric: "auto"
    }).format(
      Math.round((date.getTime() - Date.now()) / 60000),
      "minute"
    );
  } catch {
    return date.toLocaleDateString("ar-EG");
  }
}

async function requireUser() {
  if (currentUser?.id) return currentUser;

  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    throw new Error("سجّل الدخول أولًا لعرض الإشعارات.");
  }

  currentUser = data.user;

  return currentUser;
}

function getNotificationIcon(type = "") {
  const value = String(type).toLowerCase();

  if (value.includes("like")) {
    return "fa-solid fa-heart";
  }

  if (value.includes("comment")) {
    return "fa-solid fa-comment";
  }

  if (value.includes("follow")) {
    return "fa-solid fa-user-plus";
  }

  if (value.includes("message")) {
    return "fa-solid fa-message";
  }

  if (value.includes("mention")) {
    return "fa-solid fa-at";
  }

  if (value.includes("group") || value.includes("community")) {
    return "fa-solid fa-users";
  }

  return "fa-solid fa-bell";
}

function getNotificationText(notification) {
  /*
    نعرض النص المحفوظ فعلًا في الإشعار إن كان موجودًا.
    لا ننشئ أسماء أو أحداثًا وهمية.
  */

  return (
    notification.message ||
    notification.body ||
    notification.content ||
    "لديك إشعار جديد."
  );
}

function renderNotification(notification) {
  const read = Boolean(notification.read_at);

  const actorId =
    notification.actor_id ||
    notification.sender_id ||
    notification.user_id ||
    "";

  const type = notification.type || "general";

  return `
    <article
      class="nova-notification-item${read ? "" : " is-unread"}"
      data-notification-id="${escapeHTML(notification.id)}"
      data-notification-read="${read}"
    >
      <button
        type="button"
        class="nova-notification-icon"
        data-notification-open="${escapeHTML(notification.id)}"
        aria-label="فتح الإشعار"
      >
        <i class="${escapeHTML(getNotificationIcon(type))}" aria-hidden="true"></i>
      </button>

      <button
        type="button"
        class="nova-notification-content"
        data-notification-open="${escapeHTML(notification.id)}"
      >
        <span>${escapeHTML(getNotificationText(notification))}</span>
        <time datetime="${escapeHTML(notification.created_at || "")}">
          ${escapeHTML(formatTime(notification.created_at))}
        </time>
      </button>

      <div class="nova-notification-actions">
        ${
          !read
            ? `
              <button
                type="button"
                data-mark-notification-read="${escapeHTML(notification.id)}"
                aria-label="تحديد كمقروء"
                title="تحديد كمقروء"
              >
                <i class="fa-solid fa-check" aria-hidden="true"></i>
              </button>
            `
            : ""
        }

        ${
          actorId
            ? `
              <button
                type="button"
                data-notification-profile="${escapeHTML(actorId)}"
                aria-label="عرض الملف الشخصي"
                title="عرض الملف الشخصي"
              >
                <i class="fa-regular fa-user" aria-hidden="true"></i>
              </button>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderEmptyState() {
  return `
    <div class="nova-empty-state">
      <div class="nova-empty-icon">
        <i class="fa-regular fa-bell-slash" aria-hidden="true"></i>
      </div>

      <h3>لا توجد إشعارات حتى الآن</h3>

      <p>
        ستظهر هنا الإشعارات الجديدة المتعلقة بحسابك ونشاطك.
      </p>
    </div>
  `;
}

function updateUnreadBadge(count) {
  notificationState.unreadCount = Math.max(0, Number(count) || 0);

  const badge = el("#notification-badge");

  if (badge) {
    badge.textContent = notificationState.unreadCount > 99
      ? "99+"
      : String(notificationState.unreadCount);

    badge.hidden = notificationState.unreadCount === 0;
    badge.setAttribute(
      "aria-label",
      `${notificationState.unreadCount} إشعار غير مقروء`
    );
  }

  document.dispatchEvent(
    new CustomEvent("nova:unread-notifications-changed", {
      detail: {
        count: notificationState.unreadCount
      }
    })
  );
}

function calculateUnreadCount(items) {
  return items.filter(item => !item.read_at).length;
}

function renderNotifications() {
  const container = el("#notifications-list");

  if (!container) return;

  container.innerHTML = notificationState.items.length
    ? notificationState.items.map(renderNotification).join("")
    : renderEmptyState();

  updateUnreadBadge(calculateUnreadCount(notificationState.items));
}

async function loadNotifications(options = {}) {
  if (loading) return notificationState.items;

  loading = true;

  const container = el("#notifications-list");

  if (container && !options.silent) {
    container.innerHTML = `
      <div class="nova-loading-state" role="status">
        جارٍ تحميل الإشعارات...
      </div>
    `;
  }

  try {
    const user = await requireUser();

    /*
      الأعمدة المؤكدة في المشروع:
      notifications.recipient_id
      notifications.read_at
    */

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", user.id)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATIONS_LIMIT);

    if (error) throw error;

    notificationState.items = data || [];

    renderNotifications();

    return notificationState.items;
  } catch (error) {
    console.error("تعذر تحميل الإشعارات:", error);

    if (container && !options.silent) {
      container.innerHTML = `
        <div class="nova-empty-state">
          <h3>تعذر تحميل الإشعارات</h3>
          <p>تحقق من الاتصال وقواعد صلاحيات قاعدة البيانات، ثم حاول مرة أخرى.</p>
          <button type="button" data-refresh-notifications>
            إعادة المحاولة
          </button>
        </div>
      `;
    }

    notify(
      error.message || "حدث خطأ أثناء تحميل الإشعارات.",
      "error"
    );

    return [];
  } finally {
    loading = false;
  }
}

async function markNotificationRead(notificationId) {
  const user = await requireUser();

  const notification = notificationState.items.find(
    item => item.id === notificationId
  );

  if (!notification || notification.read_at) {
    return notification;
  }

  const readAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("notifications")
    .update({
      read_at: readAt
    })
    .eq("id", notificationId)
    .eq("recipient_id", user.id)
    .is("read_at", null)
    .select("*")
    .maybeSingle();

  if (error) throw error;

  /*
    إذا لم يُرجع التحديث صفًا، فقد يكون الإشعار قد تغير بالفعل
    أو أن سياسة RLS لا تسمح بتعديله.
  */

  if (data) {
    const index = notificationState.items.findIndex(
      item => item.id === notificationId
    );

    if (index !== -1) {
      notificationState.items[index] = data;
    }
  } else {
    notification.updated_read_state = true;
    notification.read_at = readAt;
  }

  renderNotifications();

  return data || notification;
}

async function markAllNotificationsRead() {
  const user = await requireUser();

  const unreadIds = notificationState.items
    .filter(item => !item.read_at)
    .map(item => item.id);

  if (!unreadIds.length) {
    notify("كل الإشعارات مقروءة بالفعل.", "info");
    return;
  }

  const readAt = new Date().toISOString();

  const { error } = await supabase
    .from("notifications")
    .update({
      read_at: readAt
    })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) {
    console.error(error);
    throw error;
  }

  notificationState.items = notificationState.items.map(item => ({
    ...item,
    read_at: item.read_at || readAt
  }));

  renderNotifications();

  notify("تم تحديد الإشعارات كمقروءة.", "success");
}

async function openNotification(notificationId) {
  let notification = notificationState.items.find(
    item => item.id === notificationId
  );

  if (!notification) {
    await loadNotifications({ silent: true });

    notification = notificationState.items.find(
      item => item.id === notificationId
    );
  }

  if (!notification) {
    notify("الإشعار غير موجود.", "warning");
    return;
  }

  if (!notification.read_at) {
    try {
      await markNotificationRead(notificationId);
    } catch (error) {
      console.warn("تعذر تحديث حالة الإشعار:", error);
    }
  }

  const actorId =
    notification.actor_id ||
    notification.sender_id ||
    "";

  if (actorId && typeof window.NOVA?.social?.openProfile === "function") {
    await window.NOVA.social.openProfile(actorId);
    return;
  }

  /*
    لا نفترض وجود post_id أو conversation_id قبل التأكد منهما.
    إذا احتوى الإشعار على رابط داخلي محفوظ، يمكن استخدامه.
  */

  const targetURL = notification.url || notification.link;

  if (targetURL) {
    try {
      const parsed = new URL(targetURL, window.location.origin);

      if (parsed.origin === window.location.origin) {
        window.location.href = parsed.href;
        return;
      }
    } catch {
      console.warn("رابط الإشعار غير صالح.");
    }
  }

  notify("تم فتح الإشعار.", "success");
}

async function handleNotificationClick(event) {
  const markButton = event.target.closest(
    "[data-mark-notification-read]"
  );

  if (markButton) {
    event.preventDefault();

    try {
      await markNotificationRead(
        markButton.dataset.markNotificationRead
      );
    } catch (error) {
      console.error(error);
      notify("تعذر تحديث حالة الإشعار.", "error");
    }

    return;
  }

  const openButton = event.target.closest(
    "[data-notification-open]"
  );

  if (openButton) {
    event.preventDefault();

    await openNotification(
      openButton.dataset.notificationOpen
    );

    return;
  }

  const profileButton = event.target.closest(
    "[data-notification-profile]"
  );

  if (profileButton) {
    event.preventDefault();

    const userId = profileButton.dataset.notificationProfile;

    if (typeof window.NOVA?.social?.openProfile === "function") {
      await window.NOVA.social.openProfile(userId);
    } else {
      notify("ميزة الملفات الشخصية لم تُشغّل بعد.", "warning");
    }

    return;
  }

  const refreshButton = event.target.closest(
    "[data-refresh-notifications]"
  );

  if (refreshButton) {
    await loadNotifications();
    return;
  }

  const markAllButton = event.target.closest(
    "#mark-all-notifications-read"
  );

  if (markAllButton) {
    try {
      await markAllNotificationsRead();
    } catch (error) {
      console.error(error);
      notify("تعذر تحديث الإشعارات.", "error");
    }
  }
}

function subscribeToNotifications() {
  if (!currentUser?.id) return;

  if (notificationChannel) {
    supabase.removeChannel(notificationChannel);
    notificationChannel = null;
  }

  notificationChannel = supabase
    .channel(`nova-notifications-${currentUser.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${currentUser.id}`
      },
      async payload => {
        if (payload.eventType === "INSERT") {
          const newItem = payload.new;

          const exists = notificationState.items.some(
            item => item.id === newItem.id
          );

          if (!exists) {
            notificationState.items.unshift(newItem);

            notificationState.items = notificationState.items.slice(
              0,
              NOTIFICATIONS_LIMIT
            );

            renderNotifications();

            notify("لديك إشعار جديد.", "info");
          }

          return;
        }

        if (
          payload.eventType === "UPDATE" ||
          payload.eventType === "DELETE"
        ) {
          await loadNotifications({ silent: true });
        }
      }
    )
    .subscribe(status => {
      if (status === "CHANNEL_ERROR") {
        console.warn("تعذر تشغيل الإشعارات اللحظية.");
      }
    });
}

function bindNotificationEvents() {
  if (initialized) return;

  initialized = true;

  document.addEventListener("click", handleNotificationClick);

  const refreshButton = el("#refresh-notifications");

  refreshButton?.addEventListener("click", () => {
    loadNotifications();
  });
}

async function initializeNotifications(user = null) {
  currentUser = user;

  try {
    if (!currentUser?.id) {
      currentUser = await requireUser();
    }

    bindNotificationEvents();

    await loadNotifications();

    subscribeToNotifications();
  } catch (error) {
    console.error("تعذر تشغيل الإشعارات:", error);

    notify(
      error.message || "تعذر تشغيل الإشعارات.",
      "error"
    );
  }
}

function setNotificationUser(user) {
  if (currentUser?.id !== user?.id) {
    if (notificationChannel) {
      supabase.removeChannel(notificationChannel);
      notificationChannel = null;
    }

    notificationState.items = [];
    notificationState.unreadCount = 0;

    updateUnreadBadge(0);
  }

  currentUser = user || null;
}

window.NOVA = window.NOVA || {};

window.NOVA.notifications = {
  initialize: initializeNotifications,
  setUser: setNotificationUser,
  load: loadNotifications,
  markRead: markNotificationRead,
  markAllRead: markAllNotificationsRead,
  open: openNotification,
  getUnreadCount: () => notificationState.unreadCount
};

export {
  initializeNotifications,
  setNotificationUser,
  loadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  openNotification
};
