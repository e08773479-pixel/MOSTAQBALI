import { supabase } from "./supabase.js";

window.NOVA = window.NOVA || {};

const PROFILE_BUCKET = "nova-avatars";
const COVER_BUCKET = "nova-covers";

const AVATAR_MAX_SIZE = 5 * 1024 * 1024;
const COVER_MAX_SIZE = 10 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

let currentUser = null;
let currentProfile = null;
let initialized = false;
let activeRequest = 0;

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

  const existing = $("#nova-profile-toast");

  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");

  toast.id = "nova-profile-toast";
  toast.textContent = message;

  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "99999",
    padding: "12px 18px",
    borderRadius: "12px",
    background: type === "error" ? "#b42318" : "#17211d",
    color: "#fff",
    boxShadow: "0 8px 30px #0003",
    maxWidth: "90%",
    textAlign: "center",
    fontSize: "14px"
  });

  document.body.appendChild(toast);

  window.setTimeout(() => toast.remove(), 3500);
}

function setText(selector, value) {
  const element = $(selector);

  if (element) {
    element.textContent = value ?? "";
  }
}

function setImage(selector, url, fallback = "") {
  const element = $(selector);

  if (!element) return;

  if (!url) {
    if (fallback) {
      element.src = fallback;
      element.hidden = false;
    }

    return;
  }

  if (element.tagName === "IMG") {
    element.src = url;
    element.hidden = false;
    element.onerror = () => {
      element.onerror = null;

      if (fallback) {
        element.src = fallback;
      }
    };
  } else {
    element.style.backgroundImage = `url("${String(url).replace(/["\\]/g, "\\$&")}")`;
  }
}

function getInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);

  if (!parts.length) return "N";

  return parts
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join("")
    .toUpperCase();
}

function getAvatarUrl(profile) {
  if (!profile) return "";

  if (profile.avatar_path) {
    const { data } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(profile.avatar_path);

    return data?.publicUrl || "";
  }

  return profile.avatar_url || "";
}

function getCoverUrl(profile) {
  if (!profile) return "";

  if (profile.cover_path) {
    const { data } = supabase.storage
      .from(COVER_BUCKET)
      .getPublicUrl(profile.cover_path);

    return data?.publicUrl || "";
  }

  return profile.cover_url || "";
}

function getProfileName(profile) {
  return (
    profile?.full_name ||
    profile?.username ||
    "مستخدم NOVA"
  );
}

function getUsername(profile) {
  const username = profile?.username || "";

  if (!username) return "";

  return username.startsWith("@")
    ? username
    : `@${username}`;
}

function showLoading(message = "جارٍ تحميل الملف الشخصي...") {
  const container = $("#profile-posts");

  if (container) {
    container.setAttribute("aria-busy", "true");
  }

  const status = $("#profile-loading-status");

  if (status) {
    status.textContent = message;
    status.hidden = false;
  }
}

function hideLoading() {
  const container = $("#profile-posts");

  if (container) {
    container.setAttribute("aria-busy", "false");
  }

  const status = $("#profile-loading-status");

  if (status) {
    status.hidden = true;
  }
}

function renderProfile(profile) {
  currentProfile = profile;

  const name = getProfileName(profile);
  const username = getUsername(profile);
  const bio = profile?.bio || "";
  const avatarUrl = getAvatarUrl(profile);
  const coverUrl = getCoverUrl(profile);

  setText("#profile-name", name);
  setText("#profile-username", username);
  setText("#profile-bio", bio);

  setImage("#profile-avatar", avatarUrl);
  setImage("#profile-cover", coverUrl);

  const avatar = $("#profile-avatar");

  if (avatar && avatar.tagName !== "IMG") {
    avatar.textContent = getInitials(name);
  }

  const ownProfile =
    currentUser &&
    profile?.id === currentUser.id;

  const editButton = $("#edit-profile-btn");
  const settingsEditButton = $("#settings-edit-profile");

  if (editButton) {
    editButton.hidden = !ownProfile;
  }

  if (settingsEditButton) {
    settingsEditButton.hidden = !ownProfile;
  }

  const shareButton = $("#profile-share-btn");

  if (shareButton) {
    shareButton.hidden = false;
  }

  document.dispatchEvent(
    new CustomEvent("nova:profile-loaded", {
      detail: {
        profile,
        isOwnProfile: Boolean(ownProfile)
      }
    })
  );
}

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("لم يتم العثور على الملف الشخصي.");
  }

  return data;
}

async function fetchCount(table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select("*", {
      count: "exact",
      head: true
    })
    .eq(column, value);

  if (error) {
    console.warn(`NOVA profile count: ${table}`, error);
    return null;
  }

  return count ?? 0;
}

async function loadCounts(userId) {
  const [postsCount, followersCount, followingCount] =
    await Promise.all([
      fetchCount("posts", "user_id", userId),
      fetchCount("user_follows", "following_id", userId),
      fetchCount("user_follows", "follower_id", userId)
    ]);

  if (postsCount !== null) {
    setText("#profile-post-count", postsCount);
  }

  if (followersCount !== null) {
    setText("#profile-followers-count", followersCount);
  }

  if (followingCount !== null) {
    setText("#profile-following-count", followingCount);
  }

  return {
    posts: postsCount,
    followers: followersCount,
    following: followingCount
  };
}

async function loadProfilePosts(userId) {
  const container = $("#profile-posts");

  if (!container) return;

  const social = window.NOVA.social;

  if (
    social &&
    typeof social.loadProfilePosts === "function"
  ) {
    try {
      await social.loadProfilePosts(userId);
      return;
    } catch (error) {
      console.error("NOVA: تعذر تحميل المنشورات من social.js", error);
    }
  }

  container.innerHTML = `
    <div class="nova-empty-state">
      <p>تعذر تحميل المنشورات من وحدة المنشورات.</p>
      <button type="button" id="nova-profile-retry-posts">
        إعادة المحاولة
      </button>
    </div>
  `;

  $("#nova-profile-retry-posts")?.addEventListener(
    "click",
    () => loadProfilePosts(userId)
  );
}

async function load(userId = currentUser?.id) {
  if (!userId) {
    notify("سجّل الدخول أولًا لعرض الملف الشخصي.", "error");
    return null;
  }

  const requestId = ++activeRequest;

  showLoading();

  try {
    const profile = await fetchProfile(userId);

    if (requestId !== activeRequest) {
      return null;
    }

    renderProfile(profile);

    await Promise.all([
      loadCounts(userId),
      loadProfilePosts(userId)
    ]);

    return profile;
  } catch (error) {
    console.error("NOVA profile load error:", error);

    if (requestId === activeRequest) {
      notify(
        error.message || "تعذر تحميل الملف الشخصي.",
        "error"
      );
    }

    return null;
  } finally {
    if (requestId === activeRequest) {
      hideLoading();
    }
  }
}

function validateImage(file, maxSize) {
  if (!file) {
    throw new Error("اختر صورة أولًا.");
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(
      "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP."
    );
  }

  if (file.size > maxSize) {
    const limitMB = Math.round(maxSize / (1024 * 1024));

    throw new Error(
      `حجم الصورة أكبر من الحد المسموح (${limitMB} ميجابايت).`
    );
  }
}

function createStoragePath(userId, file) {
  const extensionMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };

  const extension = extensionMap[file.type];

  return `${userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

async function uploadImage({
  file,
  bucket,
  column,
  maxSize,
  label
}) {
  if (!currentUser) {
    throw new Error("يجب تسجيل الدخول أولًا.");
  }

  validateImage(file, maxSize);

  const path = createStoragePath(currentUser.id, file);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (uploadError) {
    console.error("NOVA storage upload error:", uploadError);
    throw new Error(
      "تعذر رفع الصورة. تأكد من صلاحيات Storage وسياسات الرفع."
    );
  }

  const { data: updatedProfile, error: updateError } =
    await supabase
      .from("profiles")
      .update({
        [column]: path
      })
      .eq("id", currentUser.id)
      .select("*")
      .maybeSingle();

  if (updateError || !updatedProfile) {
    console.error("NOVA profile image update error:", updateError);

    // لا نترك ملفًا جديدًا غير مرتبط بالملف الشخصي.
    await supabase.storage
      .from(bucket)
      .remove([path])
      .catch(() => {});

    throw new Error(
      `تم رفض حفظ ${label} في قاعدة البيانات. تأكد أن عمود ${column} موجود وأن سياسة التحديث تسمح بذلك.`
    );
  }

  currentProfile = updatedProfile;
  renderProfile(updatedProfile);

  notify(`تم تحديث ${label} بنجاح.`, "success");

  return updatedProfile;
}

async function uploadAvatar(file) {
  return uploadImage({
    file,
    bucket: AVATAR_BUCKET,
    column: "avatar_path",
    maxSize: AVATAR_MAX_SIZE,
    label: "الصورة الشخصية"
  });
}

async function uploadCover(file) {
  return uploadImage({
    file,
    bucket: COVER_BUCKET,
    column: "cover_path",
    maxSize: COVER_MAX_SIZE,
    label: "صورة الغلاف"
  });
}

function getModalElements() {
  return {
    backdrop: $("#modal-backdrop"),
    title: $("#modal-title"),
    body: $("#modal-body"),
    footer: $("#modal-footer")
  };
}

function openEditModal() {
  if (!currentUser) {
    notify("سجّل الدخول لتعديل ملفك الشخصي.", "error");
    return;
  }

  if (!currentProfile || currentProfile.id !== currentUser.id) {
    notify("لا يمكنك تعديل ملف شخصي آخر.", "error");
    return;
  }

  const modal = getModalElements();

  if (
    modal.backdrop &&
    modal.title &&
    modal.body &&
    modal.footer
  ) {
    modal.title.textContent = "تعديل الملف الشخصي";

    modal.body.innerHTML = `
      <form id="nova-edit-profile-form" novalidate>
        <div class="nova-form-field">
          <label for="nova-edit-full-name">الاسم الكامل</label>
          <input
            id="nova-edit-full-name"
            name="full_name"
            type="text"
            maxlength="80"
            required
            autocomplete="name"
            value="${escapeHTML(currentProfile.full_name || "")}"
          >
        </div>

        <div class="nova-form-field">
          <label for="nova-edit-username">اسم المستخدم</label>
          <input
            id="nova-edit-username"
            name="username"
            type="text"
            maxlength="30"
            required
            autocomplete="username"
            value="${escapeHTML(currentProfile.username || "")}"
          >
          <small>استخدم الحروف الإنجليزية والأرقام والشرطة السفلية.</small>
        </div>

        <div class="nova-form-field">
          <label for="nova-edit-bio">النبذة الشخصية</label>
          <textarea
            id="nova-edit-bio"
            name="bio"
            maxlength="300"
            rows="4"
          >${escapeHTML(currentProfile.bio || "")}</textarea>
        </div>

        <p id="nova-profile-form-error" role="alert"></p>
      </form>
    `;

    modal.footer.innerHTML = `
      <button type="button" id="nova-edit-cancel">
        إلغاء
      </button>

      <button type="submit" form="nova-edit-profile-form"
        id="nova-edit-save">
        حفظ التغييرات
      </button>
    `;

    modal.backdrop.hidden = false;
    modal.backdrop.setAttribute("aria-hidden", "false");

    $("#nova-edit-cancel")?.addEventListener("click", closeModal);

    $("#nova-edit-profile-form")?.addEventListener(
      "submit",
      saveProfile
    );

    return;
  }

  createFallbackEditModal();
}

function closeModal() {
  const modal = getModalElements();

  if (modal.backdrop) {
    modal.backdrop.hidden = true;
    modal.backdrop.setAttribute("aria-hidden", "true");
  }

  const fallback = $("#nova-profile-fallback-modal");

  if (fallback) {
    fallback.remove();
  }
}

function createFallbackEditModal() {
  $("#nova-profile-fallback-modal")?.remove();

  const overlay = document.createElement("div");

  overlay.id = "nova-profile-fallback-modal";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "99998",
    background: "#000a",
    display: "grid",
    placeItems: "center",
    padding: "16px",
    overflowY: "auto"
  });

  overlay.innerHTML = `
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="nova-fallback-title"
      style="
        width:min(520px,100%);
        max-height:90vh;
        overflow:auto;
        background:var(--card-bg,#101b16);
        color:var(--text-color,#fff);
        border-radius:18px;
        padding:22px;
      "
    >
      <h2 id="nova-fallback-title">تعديل الملف الشخصي</h2>

      <form id="nova-edit-profile-form" novalidate>
        <div class="nova-form-field">
          <label for="nova-edit-full-name">الاسم الكامل</label>
          <input
            id="nova-edit-full-name"
            name="full_name"
            type="text"
            maxlength="80"
            required
            value="${escapeHTML(currentProfile.full_name || "")}"
          >
        </div>

        <div class="nova-form-field">
          <label for="nova-edit-username">اسم المستخدم</label>
          <input
            id="nova-edit-username"
            name="username"
            type="text"
            maxlength="30"
            required
            value="${escapeHTML(currentProfile.username || "")}"
          >
        </div>

        <div class="nova-form-field">
          <label for="nova-edit-bio">النبذة الشخصية</label>
          <textarea
            id="nova-edit-bio"
            name="bio"
            maxlength="300"
            rows="4"
          >${escapeHTML(currentProfile.bio || "")}</textarea>
        </div>

        <p id="nova-profile-form-error" role="alert"></p>

        <div style="display:flex;gap:10px;margin-top:16px">
          <button type="submit" id="nova-edit-save">
            حفظ التغييرات
          </button>

          <button type="button" id="nova-edit-cancel">
            إلغاء
          </button>
        </div>
      </form>
    </section>
  `;

  document.body.appendChild(overlay);

  $("#nova-edit-cancel")?.addEventListener("click", closeModal);

  $("#nova-edit-profile-form")?.addEventListener(
    "submit",
    saveProfile
  );
}

async function saveProfile(event) {
  event.preventDefault();

  if (!currentUser) return;

  const form = event.currentTarget;
  const errorElement = $("#nova-profile-form-error");
  const saveButton = $("#nova-edit-save");

  if (errorElement) {
    errorElement.textContent = "";
  }

  const fullName = $("#nova-edit-full-name")?.value.trim() || "";
  const username = (
    $("#nova-edit-username")?.value.trim() || ""
  ).replace(/^@/, "").toLowerCase();

  const bio = $("#nova-edit-bio")?.value.trim() || "";

  if (!fullName) {
    if (errorElement) {
      errorElement.textContent = "اكتب الاسم الكامل.";
    }

    return;
  }

  if (fullName.length > 80) {
    if (errorElement) {
      errorElement.textContent = "الاسم يجب ألا يتجاوز 80 حرفًا.";
    }

    return;
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    if (errorElement) {
      errorElement.textContent =
        "اسم المستخدم يجب أن يكون من 3 إلى 30 حرفًا إنجليزيًا أو رقمًا أو شرطة سفلية.";
    }

    return;
  }

  if (bio.length > 300) {
    if (errorElement) {
      errorElement.textContent = "النبذة يجب ألا تتجاوز 300 حرف.";
    }

    return;
  }

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "جارٍ الحفظ...";
  }

  try {
    // نتحقق من أن اسم المستخدم ليس مستخدمًا من حساب آخر.
    const { data: existing, error: usernameError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", currentUser.id)
      .limit(1);

    if (usernameError) {
      throw usernameError;
    }

    if (existing && existing.length > 0) {
      throw new Error("اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر.");
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        username,
        bio
      })
      .eq("id", currentUser.id)
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error(
        "لم يتم تحديث الملف الشخصي. تأكد من صلاحيات التعديل وسياسات RLS."
      );
    }

    currentProfile = data;

    renderProfile(data);
    closeModal();

    notify("تم حفظ التغييرات بنجاح.", "success");

    document.dispatchEvent(
      new CustomEvent("nova:profile-updated", {
        detail: { profile: data }
      })
    );
  } catch (error) {
    console.error("NOVA profile update error:", error);

    if (errorElement) {
      errorElement.textContent =
        error.message || "تعذر حفظ التغييرات.";
    } else {
      notify(
        error.message || "تعذر حفظ التغييرات.",
        "error"
      );
    }
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "حفظ التغييرات";
    }
  }
}

async function share() {
  const profile = currentProfile;

  if (!profile) {
    notify("حمّل الملف الشخصي أولًا.", "error");
    return;
  }

  const url = new URL(window.location.href);

  url.searchParams.set("profile", profile.id);

  const shareData = {
    title: `${getProfileName(profile)} | NOVA`,
    text: `شاهد الملف الشخصي لـ ${getProfileName(profile)} على NOVA`,
    url: url.toString()
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await navigator.clipboard.writeText(shareData.url);

    notify("تم نسخ رابط الملف الشخصي.", "success");
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("NOVA profile share error:", error);

      notify(
        "تعذر مشاركة الرابط. انسخ رابط الصفحة من المتصفح.",
        "error"
      );
    }
  }
}

function bindImageInput(selector, handler) {
  const input = $(selector);

  if (!input) return;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];

    if (!file) return;

    try {
      await handler(file);
    } catch (error) {
      console.error("NOVA image handler error:", error);

      notify(
        error.message || "تعذر تحديث الصورة.",
        "error"
      );
    } finally {
      input.value = "";
    }
  });
}

function bindEvents() {
  $("#edit-profile-btn")?.addEventListener(
    "click",
    openEditModal
  );

  $("#settings-edit-profile")?.addEventListener(
    "click",
    openEditModal
  );

  $("#profile-share-btn")?.addEventListener(
    "click",
    share
  );

  bindImageInput("#avatar-file-input", uploadAvatar);
  bindImageInput("#cover-file-input", uploadCover);

  // دعم الضغط على صورة الحساب أو الغلاف إذا كان العنصر موجودًا.
  $("#profile-avatar")?.addEventListener("dblclick", () => {
    if (currentUser?.id === currentProfile?.id) {
      $("#avatar-file-input")?.click();
    }
  });

  $("#profile-cover")?.addEventListener("dblclick", () => {
    if (currentUser?.id === currentProfile?.id) {
      $("#cover-file-input")?.click();
    }
  });

  document.addEventListener("click", event => {
    const closeButton = event.target.closest(
      "[data-close-modal]"
    );

    if (closeButton) {
      closeModal();
    }
  });
}

function setUser(user) {
  const changedUser = currentUser?.id !== user?.id;

  currentUser = user || null;

  if (changedUser) {
    activeRequest++;
    currentProfile = null;

    if (currentUser) {
      load(currentUser.id);
    } else {
      renderProfile({
        full_name: "",
        username: "",
        bio: "",
        avatar_path: null,
        cover_path: null
      });

      setText("#profile-post-count", "0");
      setText("#profile-followers-count", "0");
      setText("#profile-following-count", "0");
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

  return {
    load,
    openEditModal,
    uploadAvatar,
    uploadCover,
    share
  };
}

window.NOVA.profile = {
  initialize,
  setUser,
  load,
  openEditModal,
  uploadAvatar,
  uploadCover,
  share
};

export {
  initialize,
  setUser,
  load,
  openEditModal,
  uploadAvatar,
  uploadCover,
  share
};
