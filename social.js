import { supabase } from "./supabase.js";

const SOCIAL_BUCKETS = {
  posts: "nova-post-media",
  stories: "nova-stories",
  avatars: "nova-avatars"
};

const SOCIAL_LIMIT = 30;

let currentUser = null;
let feedLoading = false;
let feedOffset = 0;
let feedHasMore = true;
let feedObserver = null;
let socialInitialized = false;

const socialCache = {
  posts: new Map(),
  profiles: new Map(),
  likedPosts: new Set(),
  followedUsers: new Set()
};

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function getElement(selector) {
  return document.querySelector(selector);
}

function getElements(selector) {
  return [...document.querySelectorAll(selector)];
}

function notify(message, type = "info") {
  if (typeof window.NOVA?.toast === "function") {
    window.NOVA.toast(message, type);
    return;
  }

  const container = getElement("#toast-container");

  if (!container) {
    console.info("[NOVA]", message);
    return;
  }

  const toast = document.createElement("div");
  toast.className = "nova-toast";
  toast.textContent = message;
  toast.setAttribute("role", "status");

  container.appendChild(toast);

  window.setTimeout(() => toast.remove(), 3500);
}

function formatDate(dateValue) {
  if (!dateValue) return "";

  const date = new Date(dateValue);

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

function getProfileName(profile = {}) {
  return profile.full_name || profile.username || "مستخدم NOVA";
}

function getUsername(profile = {}) {
  return profile.username ? `@${profile.username}` : "@user";
}

function getAvatarURL(profile = {}) {
  if (profile.avatar_url) return profile.avatar_url;

  if (profile.avatar_path) {
    const { data } = supabase.storage
      .from(SOCIAL_BUCKETS.avatars)
      .getPublicUrl(profile.avatar_path);

    return data?.publicUrl || "";
  }

  return "";
}

function avatarMarkup(profile = {}, extraClass = "") {
  const name = getProfileName(profile);
  const avatar = getAvatarURL(profile);

  return `
    <div class="nova-avatar ${escapeHTML(extraClass)}">
      ${
        avatar
          ? `<img src="${escapeHTML(avatar)}" alt="${escapeHTML(name)}" loading="lazy">`
          : `<span aria-hidden="true">${escapeHTML(name.trim().charAt(0) || "N")}</span>`
      }
    </div>
  `;
}

function buttonMarkup({
  className,
  label,
  icon,
  active = false,
  disabled = false,
  attributes = ""
}) {
  return `
    <button
      type="button"
      class="${escapeHTML(className)}${active ? " is-active" : ""}"
      aria-label="${escapeHTML(label)}"
      ${active ? 'aria-pressed="true"' : 'aria-pressed="false"'}
      ${disabled ? "disabled" : ""}
      ${attributes}
    >
      <i class="${escapeHTML(icon)}" aria-hidden="true"></i>
      <span>${escapeHTML(label)}</span>
    </button>
  `;
}

async function requireUser() {
  if (currentUser?.id) return currentUser;

  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    throw new Error("يجب تسجيل الدخول أولاً.");
  }

  currentUser = data.user;
  return currentUser;
}

async function getProfilesByIds(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];

  const missingIds = uniqueIds.filter(
    id => !socialCache.profiles.has(id)
  );

  if (missingIds.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .in("id", missingIds);

    if (error) throw error;

    for (const profile of data || []) {
      socialCache.profiles.set(profile.id, profile);
    }
  }

  return uniqueIds.map(id => socialCache.profiles.get(id)).filter(Boolean);
}

async function getProfileById(id) {
  if (!id) return null;

  if (socialCache.profiles.has(id)) {
    return socialCache.profiles.get(id);
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  if (data) socialCache.profiles.set(id, data);

  return data;
}

async function getFollowedUserIds(userId) {
  const { data, error } = await supabase
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", userId);

  if (error) throw error;

  return (data || []).map(row => row.following_id);
}

async function getLikedPostIds(userId, postIds = []) {
  if (!postIds.length) return [];

  const { data, error } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", postIds);

  if (error) {
    /*
      قد تختلف تسمية جدول الإعجابات في قاعدة البيانات.
      عند ظهور خطأ هنا، لا نعتبر المستخدم قد أعجب بالمنشورات.
    */
    console.warn("تعذر تحميل إعجابات المستخدم:", error.message);
    return [];
  }

  return (data || []).map(row => row.post_id);
}

function getPostVisibility(post) {
  return post.visibility || post.privacy || "public";
}

function isVideoMedia(media) {
  return String(media?.media_type || "").toLowerCase().includes("video");
}

async function getPostMedia(postIds = []) {
  if (!postIds.length) return new Map();

  const { data, error } = await supabase
    .from("post_media")
    .select("*")
    .in("post_id", postIds)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const grouped = new Map();

  for (const media of data || []) {
    const list = grouped.get(media.post_id) || [];
    list.push(media);
    grouped.set(media.post_id, list);
  }

  return grouped;
}

async function getMediaURL(bucket, path, isPublic = false) {
  if (!path) return "";

  if (isPublic) {
    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return data?.publicUrl || "";
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600);

  if (error) {
    console.warn("تعذر تجهيز رابط الوسائط:", error.message);
    return "";
  }

  return data?.signedUrl || "";
}

async function enrichPosts(posts = []) {
  if (!posts.length) return [];

  const authorIds = posts.map(post => post.user_id);
  const postIds = posts.map(post => post.id);

  const [profiles, mediaByPost, followedIds] = await Promise.all([
    getProfilesByIds(authorIds),
    getPostMedia(postIds),
    currentUser?.id
      ? getFollowedUserIds(currentUser.id).catch(() => [])
      : Promise.resolve([])
  ]);

  const profilesById = new Map(
    profiles.map(profile => [profile.id, profile])
  );

  let likedIds = [];

  if (currentUser?.id) {
    likedIds = await getLikedPostIds(currentUser.id, postIds);
  }

  const likedSet = new Set(likedIds);
  const followedSet = new Set(followedIds);

  const enriched = await Promise.all(posts.map(async post => {
    const profile = profilesById.get(post.user_id) || {};
    const mediaItems = mediaByPost.get(post.id) || [];

    const media = await Promise.all(mediaItems.map(async item => ({
      ...item,
      url: await getMediaURL(
        SOCIAL_BUCKETS.posts,
        item.storage_path,
        false
      )
    })));

    const result = {
      ...post,
      profile,
      media,
      liked_by_me: likedSet.has(post.id),
      following_author: followedSet.has(post.user_id)
    };

    socialCache.posts.set(post.id, result);

    return result;
  }));

  return enriched;
}

function renderPostMedia(media = []) {
  const validMedia = media.filter(item => item.url);

  if (!validMedia.length) return "";

  const visibleMedia = validMedia.slice(0, 4);

  return `
    <div class="nova-post-media media-count-${visibleMedia.length}">
      ${visibleMedia.map(item => `
        <div class="nova-post-media-item">
          ${
            isVideoMedia(item)
              ? `<video src="${escapeHTML(item.url)}" controls preload="metadata" playsinline></video>`
              : `<img src="${escapeHTML(item.url)}" alt="وسائط المنشور" loading="lazy">`
          }
        </div>
      `).join("")}
    </div>
  `;
}

function renderPost(post) {
  const profile = post.profile || {};
  const isOwner = currentUser?.id === post.user_id;
  const liked = Boolean(post.liked_by_me);

  const likesCount = Number(post.likes_count ?? post.like_count ?? 0);
  const commentsCount = Number(post.comments_count ?? post.comment_count ?? 0);

  const body = post.body || "";
  const timestamp = formatDate(post.created_at);

  return `
    <article class="nova-post" data-post-id="${escapeHTML(post.id)}">
      <header class="nova-post-header">
        ${avatarMarkup(profile)}

        <div class="nova-post-author">
          <button
            type="button"
            class="nova-author-name"
            data-open-profile="${escapeHTML(post.user_id)}"
          >
            ${escapeHTML(getProfileName(profile))}
          </button>

          <span>${escapeHTML(getUsername(profile))}</span>
          <time datetime="${escapeHTML(post.created_at || "")}">
            ${escapeHTML(timestamp)}
          </time>
        </div>

        <div class="nova-post-menu">
          <button
            type="button"
            class="nova-icon-button"
            data-post-menu="${escapeHTML(post.id)}"
            aria-label="خيارات المنشور"
          >
            <i class="fa-solid fa-ellipsis" aria-hidden="true"></i>
          </button>
        </div>
      </header>

      ${body ? `
        <div class="nova-post-body">${escapeHTML(body).replace(/\n/g, "<br>")}</div>
      ` : ""}

      ${renderPostMedia(post.media || [])}

      <div class="nova-post-stats">
        <span data-likes-count="${escapeHTML(post.id)}">
          ${likesCount.toLocaleString("ar-EG")} إعجاب
        </span>

        <button
          type="button"
          data-show-comments="${escapeHTML(post.id)}"
        >
          ${commentsCount.toLocaleString("ar-EG")} تعليق
        </button>
      </div>

      <div class="nova-post-actions">
        ${buttonMarkup({
          className: "nova-post-action",
          label: liked ? "أعجبني" : "إعجاب",
          icon: liked ? "fa-solid fa-heart" : "fa-regular fa-heart",
          active: liked,
          attributes: `data-like-post="${escapeHTML(post.id)}"`
        })}

        ${buttonMarkup({
          className: "nova-post-action",
          label: "تعليق",
          icon: "fa-regular fa-comment",
          attributes: `data-show-comments="${escapeHTML(post.id)}"`
        })}

        ${buttonMarkup({
          className: "nova-post-action",
          label: "مشاركة",
          icon: "fa-solid fa-share-nodes",
          attributes: `data-share-post="${escapeHTML(post.id)}"`
        })}
      </div>

      <section
        class="nova-comments-area"
        data-comments-area="${escapeHTML(post.id)}"
        hidden
      >
        <div class="nova-comments-list"></div>

        <form class="nova-comment-form" data-comment-form="${escapeHTML(post.id)}">
          <input
            type="text"
            name="body"
            maxlength="2000"
            placeholder="اكتب تعليقك..."
            aria-label="اكتب تعليقك"
            required
          >

          <button type="submit" aria-label="إرسال التعليق">
            <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
          </button>
        </form>
      </section>

      ${isOwner ? `
        <div class="nova-post-owner-tools">
          <button type="button" data-delete-post="${escapeHTML(post.id)}">
            حذف المنشور
          </button>
        </div>
      ` : ""}
    </article>
  `;
}

function renderEmptyState(title, description) {
  return `
    <div class="nova-empty-state">
      <div class="nova-empty-icon">
        <i class="fa-regular fa-images" aria-hidden="true"></i>
      </div>

      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(description)}</p>
    </div>
  `;
}

function renderPosts(container, posts, append = false) {
  if (!container) return;

  const html = posts.map(renderPost).join("");

  if (append) {
    container.insertAdjacentHTML("beforeend", html);
    return;
  }

  container.innerHTML = html || renderEmptyState(
    "لا توجد منشورات حتى الآن",
    "عندما ينشر الأشخاص محتوى جديدًا، ستراه هنا."
  );
}

async function fetchFeedPage({ reset = false } = {}) {
  if (feedLoading) return;

  const container = getElement("#feed-list");
  if (!container) return;

  if (reset) {
    feedOffset = 0;
    feedHasMore = true;
    container.innerHTML = `
      <div class="nova-loading-state" role="status">
        جارٍ تحميل المنشورات...
      </div>
    `;
  }

  if (!feedHasMore && !reset) return;

  feedLoading = true;

  try {
    await requireUser();

    const end = feedOffset + SOCIAL_LIMIT - 1;

    const { data, error } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .range(feedOffset, end);

    if (error) throw error;

    const posts = data || [];
    const enriched = await enrichPosts(posts);

    feedHasMore = posts.length === SOCIAL_LIMIT;
    feedOffset += posts.length;

    if (reset) {
      renderPosts(container, enriched);
    } else {
      if (!posts.length && feedOffset === 0) {
        renderPosts(container, []);
      } else {
        renderPosts(container, enriched, true);
      }
    }

    if (!posts.length && feedOffset > 0) {
      const endMessage = document.createElement("p");
      endMessage.className = "nova-feed-end";
      endMessage.textContent = "وصلت إلى نهاية المنشورات.";
      container.appendChild(endMessage);
    }
  } catch (error) {
    console.error("تعذر تحميل المنشورات:", error);

    if (reset) {
      container.innerHTML = renderEmptyState(
        "تعذر تحميل المنشورات",
        "تحقق من الاتصال وقواعد صلاحيات قاعدة البيانات، ثم حاول مرة أخرى."
      );
    }

    notify(error.message || "حدث خطأ أثناء تحميل المنشورات.", "error");
  } finally {
    feedLoading = false;
  }
}

async function loadFeed() {
  return fetchFeedPage({ reset: true });
}

function setupFeedPagination() {
  if (feedObserver) feedObserver.disconnect();

  const container = getElement("#feed-list");
  if (!container || !("IntersectionObserver" in window)) return;

  const sentinel = document.createElement("div");
  sentinel.className = "nova-feed-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  container.after(sentinel);

  feedObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      fetchFeedPage();
    }
  }, {
    rootMargin: "500px"
  });

  feedObserver.observe(sentinel);
}

async function uploadMedia(file, bucket, folder, options = {}) {
  if (!(file instanceof File)) {
    throw new Error("لم يتم اختيار ملف صالح.");
  }

  const allowedTypes = options.allowedTypes || [
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("نوع الملف غير مدعوم.");
  }

  const maxSize = options.maxSize || 25 * 1024 * 1024;

  if (file.size > maxSize) {
    throw new Error("حجم الملف أكبر من الحد المسموح.");
  }

  const user = await requireUser();

  const safeName = file.name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .slice(-100);

  const path = `${user.id}/${folder}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (error) throw error;

  return {
    path,
    type: file.type,
    size: file.size,
    originalName: file.name
  };
}

async function createPost({
  body = "",
  files = [],
  visibility = "public"
} = {}) {
  const user = await requireUser();
  const text = String(body).trim();

  if (!text && !files.length) {
    throw new Error("اكتب منشورًا أو اختر صورة أو فيديو.");
  }

  if (text.length > 10000) {
    throw new Error("المنشور أطول من الحد المسموح.");
  }

  const uploaded = [];

  try {
    for (const file of files) {
      const media = await uploadMedia(
        file,
        SOCIAL_BUCKETS.posts,
        "posts"
      );

      uploaded.push(media);
    }

    const postPayload = {
      user_id: user.id,
      body: text
    };

    /*
      لا نرسل أعمدة الخصوصية قبل التأكد من وجودها في قاعدة البيانات.
      العمود المؤكد هنا هو posts.body.
    */

    const { data: post, error: postError } = await supabase
      .from("posts")
      .insert(postPayload)
      .select("*")
      .single();

    if (postError) throw postError;

    if (uploaded.length) {
      const mediaPayload = uploaded.map(item => ({
        post_id: post.id,
        uploader_id: user.id,
        storage_path: item.path,
        media_type: item.type.startsWith("video/")
          ? "video"
          : item.type.startsWith("image/")
            ? "image"
            : "file"
      }));

      const { error: mediaError } = await supabase
        .from("post_media")
        .insert(mediaPayload);

      if (mediaError) {
        console.error("تعذر حفظ بيانات الوسائط:", mediaError);
        notify(
          "تم إنشاء المنشور، لكن تعذر ربط الوسائط به. راجع صلاحيات post_media.",
          "warning"
        );
      }
    }

    socialCache.posts.delete(post.id);

    return post;
  } catch (error) {
    /*
      إذا فشل إنشاء المنشور، نحاول تنظيف الملفات التي رفعناها.
      لا نحذف ملفات بعد نجاح إنشاء المنشور.
    */
    for (const item of uploaded) {
      await supabase.storage
        .from(SOCIAL_BUCKETS.posts)
        .remove([item.path])
        .catch(() => {});
    }

    throw error;
  }
}

async function handleCreatePostForm(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const textarea = getElement("#composer-text");
  const fileInput = getElement("#post-media-input");
  const button = form.querySelector('[type="submit"]');

  const body = textarea?.value || "";
  const files = [...(fileInput?.files || [])];

  if (!body.trim() && !files.length) {
    notify("اكتب شيئًا أو اختر ملفًا أولاً.", "warning");
    return;
  }

  if (button) button.disabled = true;

  try {
    await createPost({ body, files });

    if (textarea) textarea.value = "";
    if (fileInput) fileInput.value = "";

    const preview = getElement("#post-media-preview");
    if (preview) preview.replaceChildren();

    await loadFeed();

    notify("تم نشر منشورك بنجاح.", "success");
  } catch (error) {
    console.error(error);
    notify(error.message || "تعذر إنشاء المنشور.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function toggleLike(postId) {
  const user = await requireUser();

  const post = socialCache.posts.get(postId);
  if (!post) throw new Error("المنشور غير موجود.");

  const wasLiked = Boolean(post.liked_by_me);

  /*
    نفترض وجود جدول post_likes بالأعمدة user_id وpost_id.
    إذا كان مخطط مشروعك يستخدم أسماء مختلفة، يلزم مطابقتها مع قاعدة البيانات.
  */

  if (wasLiked) {
    const { error } = await supabase
      .from("post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id);

    if (error) throw error;

    post.liked_by_me = false;
    socialCache.likedPosts.delete(postId);
  } else {
    const { error } = await supabase
      .from("post_likes")
      .insert({
        post_id: postId,
        user_id: user.id
      });

    if (error) throw error;

    post.liked_by_me = true;
    socialCache.likedPosts.add(postId);
  }

  const count = getElement(`[data-likes-count="${CSS.escape(postId)}"]`);

  if (count) {
    const oldCount = Number(
      String(count.textContent).replace(/[^\d]/g, "")
    ) || 0;

    const newCount = Math.max(
      0,
      oldCount + (wasLiked ? -1 : 1)
    );

    count.textContent = `${newCount.toLocaleString("ar-EG")} إعجاب`;
  }

  const article = getElement(
    `.nova-post[data-post-id="${CSS.escape(postId)}"]`
  );

  const likeButton = article?.querySelector("[data-like-post]");

  if (likeButton) {
    likeButton.classList.toggle("is-active", !wasLiked);
    likeButton.setAttribute("aria-pressed", String(!wasLiked));

    const icon = likeButton.querySelector("i");
    const label = likeButton.querySelector("span");

    if (icon) {
      icon.className = wasLiked
        ? "fa-regular fa-heart"
        : "fa-solid fa-heart";
    }

    if (label) label.textContent = wasLiked ? "إعجاب" : "أعجبني";
  }

  return !wasLiked;
}

async function toggleFollow(targetUserId) {
  const user = await requireUser();

  if (!targetUserId || targetUserId === user.id) {
    throw new Error("لا يمكنك متابعة حسابك الشخصي.");
  }

  const { data: existing, error: findError } = await supabase
    .from("user_follows")
    .select("follower_id, following_id")
    .eq("follower_id", user.id)
    .eq("following_id", targetUserId)
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase
      .from("user_follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("following_id", targetUserId);

    if (error) throw error;

    socialCache.followedUsers.delete(targetUserId);
    return false;
  }

  const { error } = await supabase
    .from("user_follows")
    .insert({
      follower_id: user.id,
      following_id: targetUserId
    });

  if (error) throw error;

  socialCache.followedUsers.add(targetUserId);
  return true;
}

async function getPostComments(postId) {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  const comments = data || [];
  const profiles = await getProfilesByIds(
    comments.map(comment => comment.user_id)
  );

  const profilesById = new Map(
    profiles.map(profile => [profile.id, profile])
  );

  return comments.map(comment => ({
    ...comment,
    profile: profilesById.get(comment.user_id) || {}
  }));
}

function renderComment(comment) {
  const profile = comment.profile || {};

  return `
    <div class="nova-comment" data-comment-id="${escapeHTML(comment.id)}">
      ${avatarMarkup(profile, "nova-avatar-small")}

      <div class="nova-comment-content">
        <strong>${escapeHTML(getProfileName(profile))}</strong>
        <p>${escapeHTML(comment.body || "").replace(/\n/g, "<br>")}</p>
        <time>${escapeHTML(formatDate(comment.created_at))}</time>
      </div>
    </div>
  `;
}

async function showComments(postId) {
  const area = getElement(
    `[data-comments-area="${CSS.escape(postId)}"]`
  );

  if (!area) return;

  area.hidden = !area.hidden;

  if (area.hidden) return;

  const list = area.querySelector(".nova-comments-list");

  if (!list) return;

  list.innerHTML = '<p class="nova-loading-state">جارٍ تحميل التعليقات...</p>';

  try {
    const comments = await getPostComments(postId);

    list.innerHTML = comments.length
      ? comments.map(renderComment).join("")
      : '<p class="nova-no-comments">لا توجد تعليقات حتى الآن.</p>';
  } catch (error) {
    console.error(error);
    list.textContent = "تعذر تحميل التعليقات.";
  }
}

async function addComment(postId, body) {
  const user = await requireUser();
  const text = String(body || "").trim();

  if (!text) throw new Error("اكتب التعليق أولاً.");

  if (text.length > 2000) {
    throw new Error("التعليق أطول من الحد المسموح.");
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      user_id: user.id,
      body: text
    })
    .select("*")
    .single();

  if (error) throw error;

  const profile = await getProfileById(user.id);

  const area = getElement(
    `[data-comments-area="${CSS.escape(postId)}"]`
  );

  const list = area?.querySelector(".nova-comments-list");

  if (list && data) {
    list.querySelector(".nova-no-comments")?.remove();

    list.insertAdjacentHTML(
      "beforeend",
      renderComment({ ...data, profile: profile || {} })
    );
  }

  const countButton = getElement(
    `[data-show-comments="${CSS.escape(postId)}"]`
  );

  if (countButton) {
    const post = socialCache.posts.get(postId);

    if (post) {
      post.comments_count = Number(post.comments_count || 0) + 1;
    }
  }

  return data;
}

async function deletePost(postId) {
  const user = await requireUser();

  const post = socialCache.posts.get(postId);

  if (!post || post.user_id !== user.id) {
    throw new Error("لا يمكنك حذف هذا المنشور.");
  }

  const confirmed = window.confirm(
    "هل تريد حذف المنشور؟ لا يمكن التراجع عن هذا الإجراء."
  );

  if (!confirmed) return false;

  /*
    نفترض أن حذف المنشور مسموح عبر RLS لصاحبه.
    حذف بيانات الوسائط قد يعتمد على إعدادات التخزين وسياسات الحذف.
  */

  const { data: media, error: mediaReadError } = await supabase
    .from("post_media")
    .select("storage_path")
    .eq("post_id", postId);

  if (mediaReadError) {
    console.warn("تعذر جلب مسارات الوسائط:", mediaReadError.message);
  }

  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("user_id", user.id);

  if (error) throw error;

  if (media?.length) {
    const paths = media.map(item => item.storage_path).filter(Boolean);

    if (paths.length) {
      const { error: storageError } = await supabase.storage
        .from(SOCIAL_BUCKETS.posts)
        .remove(paths);

      if (storageError) {
        console.warn("حُذف المنشور لكن بعض الملفات لم تُحذف:", storageError);
      }
    }
  }

  socialCache.posts.delete(postId);

  getElement(
    `.nova-post[data-post-id="${CSS.escape(postId)}"]`
  )?.remove();

  notify("تم حذف المنشور.", "success");

  return true;
}

async function sharePost(postId) {
  const post = socialCache.posts.get(postId);

  if (!post) {
    notify("المنشور غير متاح للمشاركة.", "warning");
    return;
  }

  const url = new URL(window.location.href);
  url.hash = `post-${postId}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: "منشور على NOVA",
        text: post.body || "شاهد هذا المنشور على NOVA",
        url: url.toString()
      });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url.toString());
      notify("تم نسخ رابط المنشور.", "success");
    } else {
      window.prompt("انسخ رابط المنشور:", url.toString());
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      notify("تعذرت مشاركة المنشور.", "error");
    }
  }
}

async function searchPeople(query) {
  const text = String(query || "").trim();

  if (!text) return [];

  const safeQuery = text.replace(/[%_]/g, "");

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .or(
      `username.ilike.%${safeQuery}%,full_name.ilike.%${safeQuery}%`
    )
    .limit(20);

  if (error) throw error;

  for (const profile of data || []) {
    socialCache.profiles.set(profile.id, profile);
  }

  return data || [];
}

function renderPerson(profile) {
  const isSelf = currentUser?.id === profile.id;
  const following = socialCache.followedUsers.has(profile.id);

  return `
    <article class="nova-person-card">
      ${avatarMarkup(profile)}

      <div class="nova-person-info">
        <strong>${escapeHTML(getProfileName(profile))}</strong>
        <span>${escapeHTML(getUsername(profile))}</span>
      </div>

      ${
        isSelf
          ? '<span class="nova-self-label">حسابك</span>'
          : `
            <button
              type="button"
              class="nova-follow-button${following ? " is-following" : ""}"
              data-follow-user="${escapeHTML(profile.id)}"
              aria-pressed="${following}"
            >
              ${following ? "تتابعه" : "متابعة"}
            </button>
          `
      }
    </article>
  `;
}

async function handlePeopleSearch(event) {
  event.preventDefault();

  const input = getElement("#people-search-input");
  const results = getElement("#people-search-results");

  if (!input || !results) return;

  const query = input.value.trim();

  if (!query) {
    results.replaceChildren();
    return;
  }

  results.innerHTML = '<p class="nova-loading-state">جارٍ البحث...</p>';

  try {
    await requireUser();

    const [people, followedIds] = await Promise.all([
      searchPeople(query),
      getFollowedUserIds(currentUser.id).catch(() => [])
    ]);

    socialCache.followedUsers = new Set(followedIds);

    results.innerHTML = people.length
      ? people.map(renderPerson).join("")
      : '<p class="nova-empty-message">لم نعثر على حسابات مطابقة.</p>';
  } catch (error) {
    console.error(error);
    results.textContent = "تعذر تنفيذ البحث.";
  }
}

async function loadStories() {
  const container = getElement("#stories-list");
  if (!container) return;

  try {
    await requireUser();

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("stories")
      .select("*")
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const stories = data || [];
    const profiles = await getProfilesByIds(
      stories.map(story => story.user_id)
    );

    const profileMap = new Map(
      profiles.map(profile => [profile.id, profile])
    );

    const rendered = await Promise.all(stories.map(async story => {
      const profile = profileMap.get(story.user_id) || {};

      const url = await getMediaURL(
        SOCIAL_BUCKETS.stories,
        story.storage_path,
        false
      );

      return {
        ...story,
        profile,
        url
      };
    }));

    container.innerHTML = `
      <button type="button" class="nova-story nova-story-create" data-create-story>
        <span class="nova-story-avatar">
          ${avatarMarkup(await getProfileById(currentUser.id) || {})}
          <span class="nova-story-add">+</span>
        </span>
        <span>قصتك</span>
      </button>

      ${rendered.filter(story => story.url).map(story => `
        <button
          type="button"
          class="nova-story"
          data-view-story="${escapeHTML(story.id)}"
          data-story-url="${escapeHTML(story.url)}"
          data-story-type="${escapeHTML(story.media_type || "image")}"
          data-story-caption="${escapeHTML(story.caption || "")}"
        >
          <span class="nova-story-avatar">
            ${avatarMarkup(story.profile)}
          </span>
          <span>${escapeHTML(getProfileName(story.profile))}</span>
        </button>
      `).join("")}
    `;
  } catch (error) {
    console.error("تعذر تحميل القصص:", error);
    container.innerHTML = `
      <p class="nova-empty-message">تعذر تحميل القصص حاليًا.</p>
    `;
  }
}

async function createStory(file, caption = "") {
  const user = await requireUser();

  const media = await uploadMedia(
    file,
    SOCIAL_BUCKETS.stories,
    "stories",
    {
      maxSize: 100 * 1024 * 1024,
      allowedTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4",
        "video/webm"
      ]
    }
  );

  const expiresAt = new Date(
    Date.now() + 24 * 60 * 60 * 1000
  ).toISOString();

  const payload = {
    user_id: user.id,
    storage_path: media.path,
    media_type: media.type.startsWith("video/") ? "video" : "image",
    expires_at: expiresAt
  };

  if (caption.trim()) {
    payload.caption = caption.trim();
  }

  const { data, error } = await supabase
    .from("stories")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    await supabase.storage
      .from(SOCIAL_BUCKETS.stories)
      .remove([media.path])
      .catch(() => {});

    throw error;
  }

  await loadStories();

  notify("تم نشر قصتك بنجاح.", "success");

  return data;
}

function openStoryViewer({ url, type, caption = "", name = "" }) {
  const video = String(type).toLowerCase().includes("video");

  const markup = `
    <div class="nova-story-viewer">
      <div class="nova-story-viewer-header">
        <strong>${escapeHTML(name || "قصة")}</strong>
        <button type="button" data-close-story aria-label="إغلاق القصة">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>

      <div class="nova-story-viewer-content">
        ${
          video
            ? `<video src="${escapeHTML(url)}" controls autoplay playsinline></video>`
            : `<img src="${escapeHTML(url)}" alt="القصة">`
        }
      </div>

      ${caption ? `<p>${escapeHTML(caption)}</p>` : ""}
    </div>
  `;

  if (typeof window.NOVA?.openModal === "function") {
    window.NOVA.openModal("القصة", markup);
    return;
  }

  const backdrop = getElement("#modal-backdrop");
  const title = getElement("#modal-title");
  const body = getElement("#modal-body");
  const footer = getElement("#modal-footer");

  if (!backdrop || !body) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  if (title) title.textContent = "القصة";
  if (footer) footer.replaceChildren();

  body.innerHTML = markup;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
}

function openStoryPicker() {
  let input = getElement("#story-upload-input");

  if (!input) {
    input = document.createElement("input");
    input.id = "story-upload-input";
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,video/mp4,video/webm";
    input.hidden = true;
    document.body.appendChild(input);
  }

  input.value = "";

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      await createStory(file);
    } catch (error) {
      console.error(error);
      notify(error.message || "تعذر نشر القصة.", "error");
    }
  };

  input.click();
}

async function handleComposerMediaPreview(event) {
  const input = event.currentTarget;
  const preview = getElement("#post-media-preview");

  if (!preview) return;

  preview.replaceChildren();

  const files = [...(input.files || [])].slice(0, 10);

  for (const file of files) {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      continue;
    }

    const url = URL.createObjectURL(file);
    const wrapper = document.createElement("div");
    wrapper.className = "nova-media-preview-item";

    const element = document.createElement(
      file.type.startsWith("video/") ? "video" : "img"
    );

    element.src = url;
    element.className = "nova-media-preview";
    element.alt = "معاينة الملف";

    if (element instanceof HTMLVideoElement) {
      element.muted = true;
      element.controls = true;
    }

    wrapper.appendChild(element);
    preview.appendChild(wrapper);

    wrapper.addEventListener("DOMNodeRemoved", () => {
      URL.revokeObjectURL(url);
    }, { once: true });
  }
}

async function loadSuggestions() {
  const container = getElement("#suggestions-list");
  if (!container) return;

  try {
    const user = await requireUser();
    const followedIds = await getFollowedUserIds(user.id);

    socialCache.followedUsers = new Set(followedIds);

    const excludedIds = [...followedIds, user.id];

    let query = supabase
      .from("profiles")
      .select("*")
      .limit(10);

    if (excludedIds.length) {
      query = query.not("id", "in", `(${excludedIds.join(",")})`);
    }

    const { data, error } = await query;

    if (error) throw error;

    container.innerHTML = (data || []).length
      ? data.map(renderPerson).join("")
      : '<p class="nova-empty-message">لا توجد اقتراحات جديدة حاليًا.</p>';
  } catch (error) {
    console.warn("تعذر تحميل اقتراحات المتابعة:", error.message);
  }
}

async function loadProfilePosts(userId) {
  const container = getElement("#profile-posts");
  if (!container) return;

  container.innerHTML = '<p class="nova-loading-state">جارٍ تحميل منشورات الملف الشخصي...</p>';

  try {
    const { data, error } = await supabase
      .from("posts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(SOCIAL_LIMIT);

    if (error) throw error;

    const enriched = await enrichPosts(data || []);

    renderPosts(container, enriched);
  } catch (error) {
    console.error(error);
    container.innerHTML = renderEmptyState(
      "تعذر تحميل المنشورات",
      "تحقق من اتصالك ثم حاول مرة أخرى."
    );
  }
}

async function openProfile(userId) {
  if (!userId) return;

  try {
    const profile = await getProfileById(userId);

    if (!profile) {
      notify("الحساب غير موجود أو لا يمكن عرضه.", "warning");
      return;
    }

    if (userId === currentUser?.id) {
      if (typeof window.NOVA?.navigate === "function") {
        window.NOVA.navigate("profile");
      } else {
        getElement('[data-page="profile"]')?.click();
      }

      return;
    }

    const following = socialCache.followedUsers.has(userId);

    const markup = `
      <div class="nova-public-profile">
        <div class="nova-public-profile-avatar">
          ${avatarMarkup(profile)}
        </div>

        <h3>${escapeHTML(getProfileName(profile))}</h3>
        <p>${escapeHTML(getUsername(profile))}</p>

        <p class="nova-public-profile-bio">
          ${escapeHTML(profile.bio || "لا توجد نبذة شخصية.")}
        </p>

        <button
          type="button"
          class="nova-follow-button${following ? " is-following" : ""}"
          data-follow-user="${escapeHTML(userId)}"
          aria-pressed="${following}"
        >
          ${following ? "إلغاء المتابعة" : "متابعة"}
        </button>
      </div>
    `;

    if (typeof window.NOVA?.openModal === "function") {
      window.NOVA.openModal("الملف الشخصي", markup);
    } else {
      const backdrop = getElement("#modal-backdrop");
      const title = getElement("#modal-title");
      const body = getElement("#modal-body");

      if (!backdrop || !body) return;

      if (title) title.textContent = "الملف الشخصي";

      body.innerHTML = markup;
      backdrop.hidden = false;
      backdrop.setAttribute("aria-hidden", "false");
    }
  } catch (error) {
    console.error(error);
    notify("تعذر فتح الملف الشخصي.", "error");
  }
}

function openPostMenu(postId) {
  const post = socialCache.posts.get(postId);
  if (!post) return;

  const ownPost = currentUser?.id === post.user_id;

  const markup = `
    <div class="nova-post-menu-options">
      ${
        ownPost
          ? `
            <button type="button" data-delete-post="${escapeHTML(postId)}">
              <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
              حذف المنشور
            </button>
          `
          : `
            <button type="button" data-report-post="${escapeHTML(postId)}">
              <i class="fa-regular fa-flag" aria-hidden="true"></i>
              الإبلاغ عن المنشور
            </button>
          `
      }

      <button type="button" data-share-post="${escapeHTML(postId)}">
        <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
        مشاركة المنشور
      </button>
    </div>
  `;

  if (typeof window.NOVA?.openModal === "function") {
    window.NOVA.openModal("خيارات المنشور", markup);
    return;
  }

  const backdrop = getElement("#modal-backdrop");
  const title = getElement("#modal-title");
  const body = getElement("#modal-body");

  if (!backdrop || !body) return;

  if (title) title.textContent = "خيارات المنشور";

  body.innerHTML = markup;
  backdrop.hidden = false;
  backdrop.setAttribute("aria-hidden", "false");
}

async function reportPost(postId) {
  const confirmed = window.confirm(
    "هل تريد الإبلاغ عن هذا المنشور؟"
  );

  if (!confirmed) return;

  /*
    لا ننشئ بلاغًا وهميًا.
    تسجيل البلاغ يحتاج جدول reports وسياسة RLS مناسبة في قاعدة البيانات.
  */

  notify(
    "ميزة البلاغات تحتاج تفعيل جدول البلاغات وصلاحياته في قاعدة البيانات.",
    "warning"
  );
}

function bindSocialEvents() {
  if (socialInitialized) return;

  socialInitialized = true;

  document.addEventListener("click", async event => {
    const likeButton = event.target.closest("[data-like-post]");

    if (likeButton) {
      const postId = likeButton.dataset.likePost;
      likeButton.disabled = true;

      try {
        await toggleLike(postId);
      } catch (error) {
        console.error(error);
        notify(error.message || "تعذر تسجيل الإعجاب.", "error");
      } finally {
        likeButton.disabled = false;
      }

      return;
    }

    const commentsButton = event.target.closest("[data-show-comments]");

    if (commentsButton) {
      await showComments(commentsButton.dataset.showComments);
      return;
    }

    const shareButton = event.target.closest("[data-share-post]");

    if (shareButton) {
      await sharePost(shareButton.dataset.sharePost);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-post]");

    if (deleteButton) {
      try {
        await deletePost(deleteButton.dataset.deletePost);
      } catch (error) {
        console.error(error);
        notify(error.message || "تعذر حذف المنشور.", "error");
      }

      return;
    }

    const menuButton = event.target.closest("[data-post-menu]");

    if (menuButton) {
      openPostMenu(menuButton.dataset.postMenu);
      return;
    }

    const profileButton = event.target.closest("[data-open-profile]");

    if (profileButton) {
      await openProfile(profileButton.dataset.openProfile);
      return;
    }

    const followButton = event.target.closest("[data-follow-user]");

    if (followButton) {
      const userId = followButton.dataset.followUser;
      followButton.disabled = true;

      try {
        const nowFollowing = await toggleFollow(userId);

        socialCache.followedUsers = new Set(
          await getFollowedUserIds(currentUser.id)
        );

        const updated = socialCache.followedUsers.has(userId);

        followButton.classList.toggle("is-following", updated);
        followButton.setAttribute("aria-pressed", String(updated));
        followButton.textContent = updated ? "إلغاء المتابعة" : "متابعة";

        if (nowFollowing) {
          notify("بدأت متابعة هذا الحساب.", "success");
        } else {
          notify("تم إلغاء المتابعة.", "success");
        }
      } catch (error) {
        console.error(error);
        notify(error.message || "تعذرت عملية المتابعة.", "error");
      } finally {
        followButton.disabled = false;
      }

      return;
    }

    const createStoryButton = event.target.closest("[data-create-story]");

    if (createStoryButton) {
      openStoryPicker();
      return;
    }

    const viewStoryButton = event.target.closest("[data-view-story]");

    if (viewStoryButton) {
      openStoryViewer({
        url: viewStoryButton.dataset.storyUrl,
        type: viewStoryButton.dataset.storyType,
        caption: viewStoryButton.dataset.storyCaption
      });

      return;
    }

    const closeStoryButton = event.target.closest("[data-close-story]");

    if (closeStoryButton) {
      const backdrop = getElement("#modal-backdrop");

      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute("aria-hidden", "true");
      }

      return;
    }

    const refreshButton = event.target.closest("[data-refresh-feed]");

    if (refreshButton) {
      await loadFeed();
    }
  });

  document.addEventListener("submit", async event => {
    const commentForm = event.target.closest("[data-comment-form]");

    if (!commentForm) return;

    event.preventDefault();

    const postId = commentForm.dataset.commentForm;
    const input = commentForm.querySelector('[name="body"]');
    const button = commentForm.querySelector('[type="submit"]');

    if (!input?.value.trim()) return;

    if (button) button.disabled = true;

    try {
      await addComment(postId, input.value);
      input.value = "";
      notify("تم إضافة التعليق.", "success");
    } catch (error) {
      console.error(error);
      notify(error.message || "تعذر إضافة التعليق.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  const searchForm = getElement("#people-search-form");

  searchForm?.addEventListener("submit", handlePeopleSearch);

  const mediaInput = getElement("#post-media-input");

  mediaInput?.addEventListener("change", handleComposerMediaPreview);

  const composerForm = getElement("#post-composer-form");

  composerForm?.addEventListener("submit", handleCreatePostForm);

  /*
    لا نربط نموذجًا غير موجود.
    app.js يستطيع استدعاء الدوال المصدرة أدناه مباشرة.
  */

  getElement("#refresh-feed")?.addEventListener("click", loadFeed);
}

async function initializeSocial(user = null) {
  currentUser = user;

  if (!currentUser?.id) {
    try {
      currentUser = await requireUser();
    } catch {
      return;
    }
  }

  bindSocialEvents();
  setupFeedPagination();

  await Promise.allSettled([
    loadFeed(),
    loadStories(),
    loadSuggestions()
  ]);
}

function setSocialUser(user) {
  currentUser = user || null;

  if (!currentUser) {
    socialCache.posts.clear();
    socialCache.profiles.clear();
    socialCache.likedPosts.clear();
    socialCache.followedUsers.clear();

    feedOffset = 0;
    feedHasMore = true;
  }
}

window.NOVA = window.NOVA || {};

window.NOVA.social = {
  initialize: initializeSocial,
  setUser: setSocialUser,
  loadFeed,
  loadStories,
  loadSuggestions,
  loadProfilePosts,
  createPost,
  createStory,
  toggleLike,
  toggleFollow,
  searchPeople,
  openProfile,
  showComments
};

export {
  initializeSocial,
  setSocialUser,
  loadFeed,
  loadStories,
  loadSuggestions,
  loadProfilePosts,
  createPost,
  createStory,
  toggleLike,
  toggleFollow,
  searchPeople,
  openProfile,
  showComments
};
