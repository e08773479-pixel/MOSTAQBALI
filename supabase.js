/* =========================================
   NOVA SOCIAL
   File: supabase.js
   Supabase client configuration
========================================= */

const SUPABASE_URL = "https://cxksushmcuyomuaywgfw.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_6D7DE4aODAIqhG9Ls3gGfQ_Um-E-7f5";

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error(
    "تعذر تحميل مكتبة Supabase. تأكد من اتصال الإنترنت وإمكانية الوصول إلى CDN."
  );
}

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    },
    global: {
      headers: {
        "X-Client-Info": "nova-social-web"
      }
    }
  }
);

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return {
      user: null,
      error
    };
  }

  return {
    user: data.user,
    error: null
  };
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();

  return {
    session: data?.session ?? null,
    error: error ?? null
  };
}

export function subscribeToAuthChanges(callback) {
  const { data } = supabase.auth.onAuthStateChange(
    (event, session) => {
      callback(event, session);
    }
  );

  return data.subscription;
}

export function getStorageBucket(bucketName) {
  const allowedBuckets = [
    "nova-avatars",
    "nova-covers",
    "nova-message-files",
    "nova-post-media",
    "nova-stories"
  ];

  if (!allowedBuckets.includes(bucketName)) {
    throw new Error("اسم مخزن الملفات غير معتمد في إعدادات NOVA SOCIAL.");
  }

  return supabase.storage.from(bucketName);
}
