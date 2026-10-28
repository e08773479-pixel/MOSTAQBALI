import { supabase } from "./supabase.js";

const MESSAGE_LIMIT = 50;

let currentUser = null;
let activeConversationId = null;
let messageSubscription = null;
let conversationsSubscription = null;
let loadingMessages = false;

const messageState = {
  conversations: [],
  messages: new Map(),
  profiles: new Map()
};

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function element(selector) {
  return document.querySelector(selector);
}

function notify(message, type = "info") {
  if (typeof window.NOVA?.toast === "function") {
    window.NOVA.toast(message, type);
    return;
  }

  const container = element("#toast-container");

  if (!container) {
    console.info("[NOVA Messages]", message);
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

  return date.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatConversationDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return formatTime(value);
  }

  return date.toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "short"
  });
}

function profileName(profile = {}) {
  return profile.full_name || profile.username || "مستخدم NOVA";
}

function username(profile = {}) {
  return profile.username ? `@${profile.username}` : "";
}

function avatarURL(profile = {}) {
  if (profile.avatar_url) return profile.avatar_url;

  if (profile.avatar_path) {
    const { data } = supabase.storage
      .from("nova-avatars")
      .getPublicUrl(profile.avatar_path);

    return data?.publicUrl || "";
  }

  return "";
}

function avatarHTML(profile = {}) {
  const url = avatarURL(profile);
  const name = profileName(profile);

  return `
    <div class="nova-avatar">
      ${
        url
          ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(name)}" loading="lazy">`
          : `<span>${escapeHTML(name.charAt(0) || "N")}</span>`
      }
    </div>
  `;
}

async function requireUser() {
  if (currentUser?.id) return currentUser;

  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    throw new Error("سجّل الدخول أولًا لاستخدام الرسائل.");
  }

  currentUser = data.user;

  return currentUser;
}

async function getProfile(userId) {
  if (!userId) return null;

  if (messageState.profiles.has(userId)) {
    return messageState.profiles.get(userId);
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    messageState.profiles.set(userId, data);
  }

  return data;
}

async function getProfiles(userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean))];

  const missing = ids.filter(id => !messageState.profiles.has(id));

  if (missing.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .in("id", missing);

    if (error) throw error;

    for (const profile of data || []) {
      messageState.profiles.set(profile.id, profile);
    }
  }

  return ids
    .map(id => messageState.profiles.get(id))
    .filter(Boolean);
}

function renderEmpty(title, description) {
  return `
    <div class="nova-empty-state">
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(description)}</p>
    </div>
  `;
}

function getConversationTitle(conversation) {
  if (conversation.title) return conversation.title;

  if (conversation.kind === "group") {
    return "مجموعة جديدة";
  }

  const otherMember = conversation.otherMember;

  return profileName(otherMember || {});
}

function getConversationPreview(conversation) {
  const message = conversation.lastMessage;

  if (!message) return "ابدأ المحادثة";

  if (message.body) return message.body;

  return "تم إرسال مرفق";
}

function renderConversation(conversation) {
  const other = conversation.otherMember || {};
  const active = conversation.id === activeConversationId;

  return `
    <button
      type="button"
      class="nova-conversation-item${active ? " is-active" : ""}"
      data-open-conversation="${escapeHTML(conversation.id)}"
    >
      ${avatarHTML(other)}

      <span class="nova-conversation-details">
        <strong>${escapeHTML(getConversationTitle(conversation))}</strong>
        <span>${escapeHTML(getConversationPreview(conversation))}</span>
      </span>

      <time>
        ${escapeHTML(formatConversationDate(
          conversation.lastMessage?.created_at ||
          conversation.created_at
        ))}
      </time>
    </button>
  `;
}

async function getConversationMembers(conversationIds) {
  if (!conversationIds.length) return [];

  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds);

  if (error) throw error;

  return data || [];
}

async function loadConversations() {
  const user = await requireUser();

  const container = element("#conversation-items");

  if (container) {
    container.innerHTML = `
      <div class="nova-loading-state">جارٍ تحميل المحادثات...</div>
    `;
  }

  try {
    /*
      هذه الاستعلامات تفترض أن جدول conversation_members
      يحتوي conversation_id وuser_id.
    */

    const { data: memberships, error: membershipError } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id);

    if (membershipError) throw membershipError;

    const conversationIds = [
      ...new Set((memberships || []).map(item => item.conversation_id))
    ];

    if (!conversationIds.length) {
      messageState.conversations = [];

      if (container) {
        container.innerHTML = renderEmpty(
          "لا توجد محادثات بعد",
          "ابدأ محادثة جديدة مع أحد المستخدمين."
        );
      }

      return [];
    }

    const [
      conversationsResult,
      members
    ] = await Promise.all([
      supabase
        .from("conversations")
        .select("*")
        .in("id", conversationIds)
        .order("created_at", { ascending: false }),

      getConversationMembers(conversationIds)
    ]);

    if (conversationsResult.error) {
      throw conversationsResult.error;
    }

    const conversations = conversationsResult.data || [];

    const otherIds = [
      ...new Set(
        members
          .filter(member => member.user_id !== user.id)
          .map(member => member.user_id)
      )
    ];

    await getProfiles(otherIds);

    const enriched = await Promise.all(
      conversations.map(async conversation => {
        const memberIds = members
          .filter(member => member.conversation_id === conversation.id)
          .map(member => member.user_id);

        const otherId = memberIds.find(id => id !== user.id);

        const otherMember = otherId
          ? messageState.profiles.get(otherId)
          : null;

        const { data: latestMessages, error: latestError } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (latestError) {
          console.warn("تعذر تحميل آخر رسالة:", latestError.message);
        }

        return {
          ...conversation,
          otherMember,
          memberIds,
          lastMessage: latestMessages?.[0] || null
        };
      })
    );

    enriched.sort((a, b) => {
      const dateA = new Date(
        a.lastMessage?.created_at || a.created_at || 0
      ).getTime();

      const dateB = new Date(
        b.lastMessage?.created_at || b.created_at || 0
      ).getTime();

      return dateB - dateA;
    });

    messageState.conversations = enriched;

    if (container) {
      container.innerHTML = enriched.length
        ? enriched.map(renderConversation).join("")
        : renderEmpty(
            "لا توجد محادثات بعد",
            "ابدأ محادثة جديدة."
          );
    }

    return enriched;
  } catch (error) {
    console.error("خطأ تحميل المحادثات:", error);

    if (container) {
      container.innerHTML = renderEmpty(
        "تعذر تحميل المحادثات",
        "تحقق من اتصال قاعدة البيانات وصلاحيات الجداول."
      );
    }

    notify(error.message || "تعذر تحميل المحادثات.", "error");

    return [];
  }
}

function renderMessage(message) {
  const own = message.user_id === currentUser?.id;
  const body = message.body || "";

  return `
    <article
      class="nova-message${own ? " is-own" : ""}"
      data-message-id="${escapeHTML(message.id)}"
    >
      <div class="nova-message-bubble">
        ${
          body
            ? `<p>${escapeHTML(body).replace(/\n/g, "<br>")}</p>`
            : `<p class="nova-message-attachment">رسالة تحتوي على مرفق</p>`
        }

        <time datetime="${escapeHTML(message.created_at || "")}">
          ${escapeHTML(formatTime(message.created_at))}
        </time>
      </div>
    </article>
  `;
}

function scrollMessagesToBottom() {
  const container = element("#chat-messages");

  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

async function loadMessages(conversationId, options = {}) {
  if (!conversationId || loadingMessages) return [];

  loadingMessages = true;

  const container = element("#chat-messages");

  if (container && !options.silent) {
    container.innerHTML = `
      <div class="nova-loading-state">جارٍ تحميل الرسائل...</div>
    `;
  }

  try {
    await requireUser();

    /*
      نتحقق من عضوية المستخدم في المحادثة قبل جلب الرسائل.
      يجب أن تسمح سياسات RLS بالاستعلام للمستخدم العضو فقط.
    */

    const { data: membership, error: membershipError } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (membershipError) throw membershipError;

    if (!membership) {
      throw new Error("ليس لديك صلاحية الوصول إلى هذه المحادثة.");
    }

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(MESSAGE_LIMIT);

    if (error) throw error;

    const messages = data || [];

    messageState.messages.set(conversationId, messages);

    if (container && activeConversationId === conversationId) {
      container.innerHTML = messages.length
        ? messages.map(renderMessage).join("")
        : renderEmpty(
            "ابدأ المحادثة",
            "اكتب أول رسالة لبدء التواصل."
          );

      scrollMessagesToBottom();
    }

    return messages;
  } catch (error) {
    console.error("تعذر تحميل الرسائل:", error);

    if (container && activeConversationId === conversationId) {
      container.innerHTML = renderEmpty(
        "تعذر تحميل الرسائل",
        "تحقق من اتصالك وصلاحيات المحادثة."
      );
    }

    notify(error.message || "تعذر تحميل الرسائل.", "error");

    return [];
  } finally {
    loadingMessages = false;
  }
}

function setChatHeader(conversation) {
  const title = element("#chat-title");
  const subtitle = element("#chat-subtitle");

  if (title) {
    title.textContent = getConversationTitle(conversation);
  }

  if (subtitle) {
    subtitle.textContent = conversation.kind === "group"
      ? "مجموعة"
      : username(conversation.otherMember || {}) || "محادثة خاصة";
  }
}

async function openConversation(conversationId) {
  const conversation = messageState.conversations.find(
    item => item.id === conversationId
  );

  if (!conversation) {
    await loadConversations();
  }

  const selected = messageState.conversations.find(
    item => item.id === conversationId
  );

  if (!selected) {
    notify("المحادثة غير موجودة.", "warning");
    return;
  }

  activeConversationId = conversationId;

  getElement(".nova-conversation-item.is-active")
    ?.classList.remove("is-active");

  const button = document.querySelector(
    `[data-open-conversation="${CSS.escape(conversationId)}"]`
  );

  button?.classList.add("is-active");

  setChatHeader(selected);

  const chatScreen = element("#chat-screen");

  if (chatScreen) {
    chatScreen.hidden = false;
  }

  await loadMessages(conversationId);

  subscribeToConversation(conversationId);
}

async function sendMessage(body) {
  const user = await requireUser();

  if (!activeConversationId) {
    throw new Error("اختر محادثة أولاً.");
  }

  const text = String(body || "").trim();

  if (!text) {
    throw new Error("اكتب رسالة أولاً.");
  }

  if (text.length > 10000) {
    throw new Error("الرسالة أطول من الحد المسموح.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", activeConversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) throw membershipError;

  if (!membership) {
    throw new Error("أنت لست عضوًا في هذه المحادثة.");
  }

  /*
    نفترض أن الرسائل النصية تستخدم body وuser_id وconversation_id.
    لا ننشئ حقولًا غير مؤكدة مثل status أو attachment_url.
  */

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: activeConversationId,
      user_id: user.id,
      body: text
    })
    .select("*")
    .single();

  if (error) throw error;

  const list = element("#chat-messages");

  if (list && activeConversationId === data.conversation_id) {
    const emptyState = list.querySelector(".nova-empty-state");
    emptyState?.remove();

    list.insertAdjacentHTML("beforeend", renderMessage(data));
    scrollMessagesToBottom();
  }

  await loadConversations();

  return data;
}

function subscribeToConversation(conversationId) {
  if (messageSubscription) {
    supabase.removeChannel(messageSubscription);
    messageSubscription = null;
  }

  messageSubscription = supabase
    .channel(`nova-messages-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`
      },
      payload => {
        const message = payload.new;

        if (!message || message.conversation_id !== activeConversationId) {
          return;
        }

        if (message.user_id === currentUser?.id) {
          return;
        }

        const list = element("#chat-messages");

        if (!list) return;

        const emptyState = list.querySelector(".nova-empty-state");
        emptyState?.remove();

        list.insertAdjacentHTML("beforeend", renderMessage(message));
        scrollMessagesToBottom();

        loadConversations();
      }
    )
    .subscribe(status => {
      if (status === "CHANNEL_ERROR") {
        console.warn("تعذر إنشاء اتصال الرسائل اللحظي.");
      }
    });
}

function subscribeToConversations() {
  if (conversationsSubscription) {
    supabase.removeChannel(conversationsSubscription);
  }

  conversationsSubscription = supabase
    .channel(`nova-conversations-${currentUser.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages"
      },
      () => {
        loadConversations();
      }
    )
    .subscribe();
}

async function startDirectConversation(otherUserId) {
  const user = await requireUser();

  if (!otherUserId || otherUserId === user.id) {
    throw new Error("اختر مستخدمًا آخر لبدء المحادثة.");
  }

  /*
    لا نفترض وجود RPC لإنشاء محادثة مباشرة.
    نفحص المحادثات المشتركة أولًا.
  */

  const { data: ownMemberships, error: ownError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", user.id);

  if (ownError) throw ownError;

  const ownIds = (ownMemberships || []).map(
    item => item.conversation_id
  );

  if (ownIds.length) {
    const { data: sharedMembership, error: sharedError } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", otherUserId)
      .in("conversation_id", ownIds);

    if (sharedError) throw sharedError;

    const sharedIds = [
      ...new Set((sharedMembership || []).map(item => item.conversation_id))
    ];

    if (sharedIds.length) {
      const { data: existing, error: existingError } = await supabase
        .from("conversations")
        .select("*")
        .in("id", sharedIds)
        .eq("kind", "direct")
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing) {
        await loadConversations();
        await openConversation(existing.id);
        return existing;
      }
    }
  }

  /*
    إنشاء محادثة وعضويتها يتطلب أن تسمح سياسات RLS بذلك.
    الأفضل في الإنتاج استخدام دالة RPC ذرّية لمنع إنشاء محادثات مكررة.
  */

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      kind: "direct",
      created_by: user.id
    })
    .select("*")
    .single();

  if (conversationError) throw conversationError;

  const { error: membersError } = await supabase
    .from("conversation_members")
    .insert([
      {
        conversation_id: conversation.id,
        user_id: user.id
      },
      {
        conversation_id: conversation.id,
        user_id: otherUserId
      }
    ]);

  if (membersError) {
    console.error(
      "تم إنشاء المحادثة لكن تعذرت إضافة الأعضاء:",
      membersError
    );

    throw new Error(
      "تعذرت إضافة أعضاء المحادثة. راجع سياسات conversation_members."
    );
  }

  await loadConversations();
  await openConversation(conversation.id);

  return conversation;
}

async function handleChatSubmit(event) {
  event.preventDefault();

  const input = element("#chat-message-input");
  const button = element("#chat-send-btn");

  if (!input) return;

  const text = input.value.trim();

  if (!text) return;

  if (button) button.disabled = true;

  try {
    await sendMessage(text);
    input.value = "";
    input.focus();
  } catch (error) {
    console.error(error);
    notify(error.message || "تعذر إرسال الرسالة.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function bindMessageEvents() {
  document.addEventListener("click", async event => {
    const conversationButton = event.target.closest(
      "[data-open-conversation]"
    );

    if (conversationButton) {
      await openConversation(
        conversationButton.dataset.openConversation
      );

      return;
    }

    const refreshButton = event.target.closest("#refresh-conversations");

    if (refreshButton) {
      await loadConversations();
    }
  });

  element("#chat-compose-form")
    ?.addEventListener("submit", handleChatSubmit);

  element("#conversation-search")
    ?.addEventListener("input", event => {
      const query = event.target.value.trim().toLowerCase();

      const filtered = messageState.conversations.filter(conversation => {
        const title = getConversationTitle(conversation).toLowerCase();

        const user = username(
          conversation.otherMember || {}
        ).toLowerCase();

        return title.includes(query) || user.includes(query);
      });

      const container = element("#conversation-items");

      if (container) {
        container.innerHTML = filtered.length
          ? filtered.map(renderConversation).join("")
          : renderEmpty(
              "لا توجد نتائج",
              "جرّب البحث باسم آخر."
            );
      }
    });
}

async function initializeMessages(user = null) {
  currentUser = user;

  try {
    await requireUser();

    bindMessageEvents();

    await loadConversations();

    subscribeToConversations();
  } catch (error) {
    console.error(error);
    notify(error.message || "تعذر تشغيل الرسائل.", "error");
  }
}

function setMessageUser(user) {
  if (currentUser?.id !== user?.id) {
    if (messageSubscription) {
      supabase.removeChannel(messageSubscription);
      messageSubscription = null;
    }

    if (conversationsSubscription) {
      supabase.removeChannel(conversationsSubscription);
      conversationsSubscription = null;
    }

    activeConversationId = null;
    messageState.conversations = [];
    messageState.messages.clear();
    messageState.profiles.clear();
  }

  currentUser = user || null;
}

window.NOVA = window.NOVA || {};

window.NOVA.messages = {
  initialize: initializeMessages,
  setUser: setMessageUser,
  loadConversations,
  loadMessages,
  openConversation,
  sendMessage,
  startDirectConversation
};

export {
  initializeMessages,
  setMessageUser,
  loadConversations,
  loadMessages,
  openConversation,
  sendMessage,
  startDirectConversation
};
