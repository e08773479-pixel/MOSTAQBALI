import { supabase } from "./supabase.js";

window.NOVA = window.NOVA || {};

const COMMUNITY_SELECT = "*";

let currentUser = null;
let initialized = false;
let activeCommunityId = null;
let communitiesChannel = null;
let loadingCommunities = false;

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

  const oldToast = $("#nova-community-toast");
  oldToast?.remove();

  const toast = document.createElement("div");

  toast.id = "nova-community-toast";
  toast.textContent = message;

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    background: type === "error" ? "#b42318" : "#17211d",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: "12px",
    zIndex: "99999",
    maxWidth: "90%",
    textAlign: "center",
    boxShadow: "0 8px 30px #0003"
  });

  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3500);
}

function showError(container, message) {
  if (!container) return;

  container.innerHTML = `
    <div class="nova-community-error" role="alert">
      <p>${escapeHTML(message)}</p>
      <button type="button" data-community-retry>
        إعادة المحاولة
      </button>
    </div>
  `;

  container.querySelector("[data-community-retry]")
    ?.addEventListener("click", () => loadCommunities());
}

function getCommunityName(community) {
  return community.name || community.title || "مجتمع جديد";
}

function getCommunityDescription(community) {
  return community.description || community.bio || "";
}

function getCommunityImage(community) {
  return (
    community.avatar_url ||
    community.image_url ||
    community.cover_url ||
    ""
  );
}

function getCreatedBy(community) {
  return (
    community.created_by ||
    community.owner_id ||
    community.user_id ||
    null
  );
}

function renderCommunityCard(community, membership = null) {
  const id = community.id;
  const name = getCommunityName(community);
  const description = getCommunityDescription(community);
  const image = getCommunityImage(community);

  const creatorId = getCreatedBy(community);
  const isCreator = creatorId === currentUser?.id;
  const isMember = Boolean(membership);

  const imageMarkup = image
    ? `
      <img
        class="nova-community-image"
        src="${escapeHTML(image)}"
        alt=""
        loading="lazy"
        onerror="this.style.display='none'"
      >
    `
    : `
      <div class="nova-community-image-placeholder" aria-hidden="true">
        ${escapeHTML(name.trim().charAt(0).toUpperCase() || "N")}
      </div>
    `;

  return `
    <article
      class="nova-community-card"
      data-community-id="${escapeHTML(id)}"
    >
      ${imageMarkup}

      <div class="nova-community-card-content">
        <h3>${escapeHTML(name)}</h3>

        <p>${escapeHTML(description || "لا يوجد وصف لهذا المجتمع حتى الآن.")}</p>

        <div class="nova-community-card-actions">
          <button
            type="button"
            data-community-open="${escapeHTML(id)}"
          >
            عرض المجتمع
          </button>

          ${
            isMember
              ? `
                <button
                  type="button"
                  data-community-leave="${escapeHTML(id)}"
                  ${isCreator ? "disabled title='لا يمكنك مغادرة مجتمعك قبل نقل الإدارة أو حذفه'" : ""}
                >
                  ${isCreator ? "أنت المنشئ" : "مغادرة"}
                </button>
              `
              : `
                <button
                  type="button"
                  data-community-join="${escapeHTML(id)}"
                >
                  انضمام
                </button>
              `
          }
        </div>
      </div>
    </article>
  `;
}

async function fetchMemberships(communityIds) {
  if (!currentUser || !communityIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("community_members")
    .select("*")
    .eq("user_id", currentUser.id)
    .in("community_id", communityIds);

  if (error) {
    console.warn("NOVA community membership query:", error);
    return new Map();
  }

  return new Map(
    (data || []).map(member => [member.community_id, member])
  );
}

async function loadCommunities(options = {}) {
  const container =
    $(options.container || "#communities-list") ||
    $("#community-discovery-list");

  if (!container) {
    console.warn(
      "NOVA communities: لم يتم العثور على عنصر عرض المجتمعات في HTML."
    );
    return [];
  }

  if (loadingCommunities) return [];

  loadingCommunities = true;

  container.setAttribute("aria-busy", "true");
  container.innerHTML = `
    <div class="nova-community-loading">
      جارٍ تحميل المجتمعات...
    </div>
  `;

  try {
    let query = supabase
      .from("communities")
      .select(COMMUNITY_SELECT)
      .order("created_at", { ascending: false })
      .limit(100);

    const searchInput = $("#community-search-input");
    const searchTerm = options.search ??
      searchInput?.value.trim() ??
      "";

    if (searchTerm) {
      // نستخدم بحثًا بسيطًا بالاسم؛ النص يُنظَّف قبل إدخاله في صيغة ilike.
      const safeTerm = searchTerm
        .replace(/[%_,()]/g, " ")
        .trim();

      if (safeTerm) {
        query = query.ilike("name", `%${safeTerm}%`);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    const communities = data || [];
    const memberships = await fetchMemberships(
      communities.map(community => community.id)
    );

    if (!communities.length) {
      container.innerHTML = `
        <div class="nova-community-empty">
          <h3>لا توجد مجتمعات حتى الآن</h3>
          <p>أنشئ مجتمعك الأول أو جرّب البحث بكلمة أخرى.</p>
        </div>
      `;

      return [];
    }

    container.innerHTML = communities
      .map(community => renderCommunityCard(
        community,
        memberships.get(community.id)
      ))
      .join("");

    return communities;
  } catch (error) {
    console.error("NOVA load communities error:", error);

    showError(
      container,
      "تعذر تحميل المجتمعات. تحقق من اتصال Supabase والجداول والصلاحيات."
    );

    return [];
  } finally {
    loadingCommunities = false;
    container.setAttribute("aria-busy", "false");
  }
}

async function loadMyCommunities() {
  const container = $("#my-communities-list");

  if (!container) return [];

  if (!currentUser) {
    container.innerHTML = `
      <p>سجّل الدخول لعرض المجتمعات التي انضممت إليها.</p>
    `;
    return [];
  }

  container.innerHTML = "<p>جارٍ تحميل مجتمعاتك...</p>";

  try {
    const { data: memberships, error: membershipError } =
      await supabase
        .from("community_members")
        .select("community_id")
        .eq("user_id", currentUser.id);

    if (membershipError) throw membershipError;

    const ids = [...new Set(
      (memberships || []).map(item => item.community_id)
    )];

    if (!ids.length) {
      container.innerHTML = `
        <div class="nova-community-empty">
          لم تنضم لأي مجتمع بعد.
        </div>
      `;

      return [];
    }

    const { data: communities, error } = await supabase
      .from("communities")
      .select("*")
      .in("id", ids);

    if (error) throw error;

    container.innerHTML = (communities || [])
      .map(community => renderCommunityCard(community, {
        community_id: community.id,
        user_id: currentUser.id
      }))
      .join("");

    return communities || [];
  } catch (error) {
    console.error("NOVA my communities error:", error);

    showError(
      container,
      "تعذر تحميل مجتمعاتك. تأكد من صلاحيات الوصول."
    );

    return [];
  }
}

async function joinCommunity(communityId) {
  if (!currentUser) {
    notify("سجّل الدخول للانضمام إلى مجتمع.", "error");
    return false;
  }

  if (!communityId) return false;

  try {
    const { data: existing, error: checkError } = await supabase
      .from("community_members")
      .select("community_id")
      .eq("community_id", communityId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existing) {
      notify("أنت عضو بالفعل في هذا المجتمع.");
      return true;
    }

    const { error } = await supabase
      .from("community_members")
      .insert({
        community_id: communityId,
        user_id: currentUser.id
      });

    if (error) throw error;

    notify("تم الانضمام إلى المجتمع بنجاح.", "success");

    await Promise.all([
      loadCommunities(),
      loadMyCommunities()
    ]);

    document.dispatchEvent(
      new CustomEvent("nova:community-joined", {
        detail: { communityId }
      })
    );

    return true;
  } catch (error) {
    console.error("NOVA join community error:", error);

    notify(
      "تعذر الانضمام. تحقق من وجود المجتمع وسياسات قاعدة البيانات.",
      "error"
    );

    return false;
  }
}

async function leaveCommunity(communityId) {
  if (!currentUser) {
    notify("سجّل الدخول أولًا.", "error");
    return false;
  }

  if (!communityId) return false;

  try {
    const { data: community, error: communityError } = await supabase
      .from("communities")
      .select("*")
      .eq("id", communityId)
      .maybeSingle();

    if (communityError) throw communityError;

    if (!community) {
      throw new Error("المجتمع غير موجود.");
    }

    if (getCreatedBy(community) === currentUser.id) {
      notify(
        "أنت منشئ المجتمع. لا يمكنك مغادرته بهذه الطريقة.",
        "error"
      );
      return false;
    }

    const { error } = await supabase
      .from("community_members")
      .delete()
      .eq("community_id", communityId)
      .eq("user_id", currentUser.id);

    if (error) throw error;

    notify("غادرت المجتمع.", "success");

    if (activeCommunityId === communityId) {
      activeCommunityId = null;
    }

    await Promise.all([
      loadCommunities(),
      loadMyCommunities()
    ]);

    document.dispatchEvent(
      new CustomEvent("nova:community-left", {
        detail: { communityId }
      })
    );

    return true;
  } catch (error) {
    console.error("NOVA leave community error:", error);

    notify(
      error.message || "تعذر مغادرة المجتمع.",
      "error"
    );

    return false;
  }
}

function openCreateCommunityModal() {
  if (!currentUser) {
    notify("سجّل الدخول لإنشاء مجتمع.", "error");
    return;
  }

  $("#nova-create-community-modal")?.remove();

  const overlay = document.createElement("div");

  overlay.id = "nova-create-community-modal";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "99998",
    display: "grid",
    placeItems: "center",
    padding: "16px",
    overflowY: "auto",
    background: "#000a"
  });

  overlay.innerHTML = `
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="nova-create-community-title"
      style="
        width:min(520px,100%);
        background:var(--card-bg,#101b16);
        color:var(--text-color,#fff);
        border-radius:18px;
        padding:22px;
      "
    >
      <h2 id="nova-create-community-title">إنشاء مجتمع جديد</h2>

      <form id="nova-create-community-form">
        <div class="nova-form-field">
          <label for="nova-community-name">اسم المجتمع</label>
          <input
            id="nova-community-name"
            name="name"
            type="text"
            maxlength="80"
            required
            placeholder="مثال: محبو التكنولوجيا"
          >
        </div>

        <div class="nova-form-field">
          <label for="nova-community-description">الوصف</label>
          <textarea
            id="nova-community-description"
            name="description"
            maxlength="500"
            rows="4"
            placeholder="ما موضوع هذا المجتمع؟"
          ></textarea>
        </div>

        <div class="nova-form-field">
          <label for="nova-community-privacy">نوع المجتمع</label>
          <select id="nova-community-privacy" name="privacy">
            <option value="public">عام</option>
            <option value="private">خاص</option>
          </select>
        </div>

        <p id="nova-create-community-error" role="alert"></p>

        <div style="display:flex;gap:10px;margin-top:16px">
          <button type="submit" id="nova-create-community-submit">
            إنشاء المجتمع
          </button>

          <button type="button" id="nova-create-community-cancel">
            إلغاء
          </button>
        </div>
      </form>
    </section>
  `;

  document.body.appendChild(overlay);

  $("#nova-create-community-cancel")
    ?.addEventListener("click", () => overlay.remove());

  $("#nova-create-community-form")
    ?.addEventListener("submit", createCommunity);
}

async function createCommunity(event) {
  event.preventDefault();

  if (!currentUser) return;

  const name = $("#nova-community-name")?.value.trim() || "";
  const description =
    $("#nova-community-description")?.value.trim() || "";

  const privacy =
    $("#nova-community-privacy")?.value || "public";

  const errorElement = $("#nova-create-community-error");
  const submitButton = $("#nova-create-community-submit");

  if (!name) {
    if (errorElement) {
      errorElement.textContent = "اكتب اسم المجتمع.";
    }
    return;
  }

  if (name.length < 3 || name.length > 80) {
    if (errorElement) {
      errorElement.textContent =
        "اسم المجتمع يجب أن يكون من 3 إلى 80 حرفًا.";
    }
    return;
  }

  if (description.length > 500) {
    if (errorElement) {
      errorElement.textContent =
        "الوصف يجب ألا يتجاوز 500 حرف.";
    }
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "جارٍ الإنشاء...";
  }

  try {
    /*
      الأعمدة الأساسية المفترضة:
      name, description, created_by

      إذا كان جدولك يستخدم اسم عمود مختلفًا للمنشئ،
      عدّل created_by هنا ليتوافق مع المخطط الفعلي.
    */
    const payload = {
      name,
      description,
      created_by: currentUser.id
    };

    /*
      لا نرسل عمود privacy تلقائيًا؛ فقد لا يكون موجودًا
      في مخطط قاعدة البيانات الحالي.
    */
    const { data: community, error } = await supabase
      .from("communities")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    /*
      محاولة إضافة المنشئ كعضو.
      إذا كانت سياسة قاعدة البيانات أو مخططها لا يسمحان بذلك،
      سيظهر تحذير، لكن المجتمع نفسه قد يكون أُنشئ بالفعل.
    */
    const { error: memberError } = await supabase
      .from("community_members")
      .insert({
        community_id: community.id,
        user_id: currentUser.id
      });

    if (memberError) {
      console.warn(
        "NOVA: المجتمع أُنشئ لكن تعذرت إضافة المنشئ إلى الأعضاء.",
        memberError
      );
    }

    $("#nova-create-community-modal")?.remove();

    notify("تم إنشاء المجتمع.", "success");

    await Promise.all([
      loadCommunities(),
      loadMyCommunities()
    ]);

    document.dispatchEvent(
      new CustomEvent("nova:community-created", {
        detail: { community }
      })
    );

    return community;
  } catch (error) {
    console.error("NOVA create community error:", error);

    if (errorElement) {
      errorElement.textContent =
        "تعذر إنشاء المجتمع. تأكد من أعمدة الجدول وصلاحيات INSERT في Supabase.";
    } else {
      notify("تعذر إنشاء المجتمع.", "error");
    }

    return null;
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "إنشاء المجتمع";
    }
  }
}

async function openCommunity(communityId) {
  if (!communityId) return null;

  try {
    const { data: community, error } = await supabase
      .from("communities")
      .select("*")
      .eq("id", communityId)
      .maybeSingle();

    if (error) throw error;

    if (!community) {
      notify("المجتمع غير موجود أو لا تملك صلاحية رؤيته.", "error");
      return null;
    }

    activeCommunityId = communityId;

    const membersResult = await supabase
      .from("community_members")
      .select("user_id")
      .eq("community_id", communityId);

    const members = membersResult.data || [];

    document.dispatchEvent(
      new CustomEvent("nova:community-opened", {
        detail: {
          community,
          members,
          memberCount: members.length
        }
      })
    );

    const detailContainer = $("#community-details");

    if (detailContainer) {
      const image = getCommunityImage(community);

      detailContainer.innerHTML = `
        <section class="nova-community-details">
          ${
            image
              ? `<img src="${escapeHTML(image)}" alt="" loading="lazy">`
              : ""
          }

          <h2>${escapeHTML(getCommunityName(community))}</h2>

          <p>${escapeHTML(getCommunityDescription(community))}</p>

          <p>عدد الأعضاء: ${membersResult.error ? "غير متاح" : members.length}</p>

          <button type="button" data-community-join="${escapeHTML(communityId)}">
            انضمام
          </button>
        </section>
      `;
    }

    return community;
  } catch (error) {
    console.error("NOVA open community error:", error);

    notify("تعذر فتح المجتمع.", "error");

    return null;
  }
}

async function searchCommunities(term) {
  return loadCommunities({ search: String(term || "").trim() });
}

function bindEvents() {
  document.addEventListener("click", async event => {
    const joinButton = event.target.closest("[data-community-join]");

    if (joinButton) {
      joinButton.disabled = true;

      try {
        await joinCommunity(joinButton.dataset.communityJoin);
      } finally {
        joinButton.disabled = false;
      }

      return;
    }

    const leaveButton = event.target.closest("[data-community-leave]");

    if (leaveButton) {
      const confirmed = window.confirm(
        "هل أنت متأكد أنك تريد مغادرة هذا المجتمع؟"
      );

      if (!confirmed) return;

      leaveButton.disabled = true;

      try {
        await leaveCommunity(leaveButton.dataset.communityLeave);
      } finally {
        leaveButton.disabled = false;
      }

      return;
    }

    const openButton = event.target.closest("[data-community-open]");

    if (openButton) {
      await openCommunity(openButton.dataset.communityOpen);
    }
  });

  $("#create-community-btn")?.addEventListener(
    "click",
    openCreateCommunityModal
  );

  $("#community-create-btn")?.addEventListener(
    "click",
    openCreateCommunityModal
  );

  $("#refresh-communities-btn")?.addEventListener(
    "click",
    () => {
      loadCommunities();
      loadMyCommunities();
    }
  );

  const searchForm = $("#community-search-form");

  searchForm?.addEventListener("submit", event => {
    event.preventDefault();
    searchCommunities($("#community-search-input")?.value || "");
  });

  $("#community-search-input")?.addEventListener(
    "input",
    debounce(event => {
      searchCommunities(event.target.value);
    }, 350)
  );
}

function debounce(callback, delay = 300) {
  let timer;

  return (...args) => {
    clearTimeout(timer);

    timer = setTimeout(() => {
      callback(...args);
    }, delay);
  };
}

function subscribeToCommunities() {
  if (communitiesChannel) {
    supabase.removeChannel(communitiesChannel);
    communitiesChannel = null;
  }

  communitiesChannel = supabase
    .channel("nova-communities-changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "communities"
      },
      () => {
        loadCommunities();
        loadMyCommunities();
      }
    )
    .subscribe();
}

function setUser(user) {
  const changed = currentUser?.id !== user?.id;

  currentUser = user || null;

  if (changed) {
    activeCommunityId = null;

    if (!currentUser) {
      if (communitiesChannel) {
        supabase.removeChannel(communitiesChannel);
        communitiesChannel = null;
      }
    } else if (initialized) {
      loadCommunities();
      loadMyCommunities();
      subscribeToCommunities();
    }
  }
}

function initialize(user = null) {
  if (!initialized) {
    bindEvents();
    initialized = true;
  }

  if (user !== undefined) {
    setUser(user);
  }

  if (currentUser) {
    loadCommunities();
    loadMyCommunities();
    subscribeToCommunities();
  }

  return {
    loadCommunities,
    loadMyCommunities,
    createCommunity,
    joinCommunity,
    leaveCommunity,
    openCommunity,
    searchCommunities
  };
}

window.NOVA.communities = {
  initialize,
  setUser,
  loadCommunities,
  loadMyCommunities,
  openCreateCommunityModal,
  createCommunity,
  joinCommunity,
  leaveCommunity,
  openCommunity,
  searchCommunities
};

export {
  initialize,
  setUser,
  loadCommunities,
  loadMyCommunities,
  openCreateCommunityModal,
  createCommunity,
  joinCommunity,
  leaveCommunity,
  openCommunity,
  searchCommunities
};
