/**
 * CHEKORGANICS — Cloud Firestore & Firebase Auth Integration (firebase-db.js)
 * Supports: Orders, Customer Reviews, Newsletter, and Authentication
 * (Signup, Login, Forgot Password, Order History).
 */

(function () {
  "use strict";

  // =========================================================================
  // 1. FIREBASE CONFIGURATION
  // =========================================================================
  const firebaseConfig = {
    apiKey: "AIzaSyDkj-mzb-sEKnaIVVty77bgdAL0hdBmErc",
    authDomain: "chekorganics-live.firebaseapp.com",
    projectId: "chekorganics-live",
    storageBucket: "chekorganics-live.firebasestorage.app",
    messagingSenderId: "961047735790",
    appId: "1:961047735790:web:68d6e7fd9657d1fdabf2ff"
  };

  let db = null;
  let auth = null;
  let isReady = false;

  function checkConfigured() {
    return (
      firebaseConfig.apiKey &&
      firebaseConfig.apiKey !== "YOUR_API_KEY" &&
      firebaseConfig.projectId &&
      firebaseConfig.projectId !== "YOUR_PROJECT_ID"
    );
  }

  // Initialize Firebase App, Firestore and Auth
  try {
    if (typeof firebase !== "undefined" && checkConfigured()) {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      if (firebase.firestore) {
        db = firebase.firestore();
      }
      if (firebase.auth) {
        auth = firebase.auth();
      }
      isReady = true;
      console.log("🌿 [Firebase] Cloud Firestore & Auth initialized successfully!");
    } else {
      console.info(
        "🌿 [Firebase] Running in Local Fallback mode."
      );
    }
  } catch (err) {
    console.warn("🌿 [Firebase] Init note:", err.message);
  }

  // =========================================================================
  // 2. FIRESTORE & AUTH HELPER API
  // =========================================================================
  const FirebaseDB = {
    isConfigured: () => isReady,
    getAuth: () => auth,
    getFirestore: () => db,

    // -------------------------------- AUTHENTICATION ------------------------
    /**
     * Sign up a new user with Email and Password
     * @param {string} name
     * @param {string} email
     * @param {string} password
     */
    async signUp(name, email, password) {
      if (!auth) throw new Error("Firebase Auth is loading. Please try again.");
      const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
      if (cred.user && name) {
        await cred.user.updateProfile({ displayName: name.trim() });
        // Save user profile in Firestore
        if (db) {
          try {
            await db.collection("users").doc(cred.user.uid).set({
              name: name.trim(),
              email: email.trim().toLowerCase(),
              createdAt: new Date().toISOString()
            });
          } catch (e) {
            console.warn("User doc create note:", e.message);
          }
        }
      }
      return cred.user;
    },

    /**
     * Sign in existing user with Email and Password
     * @param {string} email
     * @param {string} password
     */
    async signIn(email, password) {
      if (!auth) throw new Error("Firebase Auth is loading. Please try again.");
      const cred = await auth.signInWithEmailAndPassword(email.trim(), password);
      return cred.user;
    },

    /**
     * Send password reset link to user's email
     * @param {string} email
     */
    async sendPasswordReset(email) {
      if (!auth) throw new Error("Firebase Auth is loading. Please try again.");
      await auth.sendPasswordResetEmail(email.trim());
      return true;
    },

    /**
     * Confirm password reset with Firebase oobCode
     * @param {string} code
     * @param {string} newPassword
     */
    async confirmPasswordReset(code, newPassword) {
      if (!auth) throw new Error("Firebase Auth is loading. Please try again.");
      await auth.confirmPasswordReset(code.trim(), newPassword);
      return true;
    },

    /**
     * Update current logged-in user password
     * @param {string} currentPassword
     * @param {string} newPassword
     */
    async updateUserPassword(currentPassword, newPassword) {
      if (!auth || !auth.currentUser) throw new Error("You must be logged in to change password.");
      const user = auth.currentUser;
      if (currentPassword) {
        const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
        await user.reauthenticateWithCredential(cred);
      }
      await user.updatePassword(newPassword);
      return true;
    },

    /**
     * Sign out current user
     */
    async signOut() {
      if (!auth) return;
      await auth.signOut();
    },

    /**
     * Get currently logged-in user
     */
    getCurrentUser() {
      return auth ? auth.currentUser : null;
    },

    /**
     * Listen for Auth state changes (login/logout)
     * @param {Function} callback
     */
    onAuthStateChanged(callback) {
      if (!auth) {
        if (typeof callback === "function") callback(null);
        return () => {};
      }
      return auth.onAuthStateChanged(callback);
    },

    // -------------------------------- ORDERS --------------------------------
    /**
     * Save customer order to Firestore
     * @param {Object} orderData
     */
    async saveOrder(orderData) {
      const currentUser = auth ? auth.currentUser : null;
      const orderPayload = {
        ...orderData,
        userId: currentUser ? currentUser.uid : null,
        // lowercased: getUserOrders queries on it and firestore.rules compares it to the auth token email
        userEmail: String((currentUser ? currentUser.email : (orderData.customer && orderData.customer.email)) || "").toLowerCase() || null,
        createdAt: new Date().toISOString(),
        cloudSynced: isReady && !!db
      };

      // Always backup locally
      try {
        const localOrders = JSON.parse(localStorage.getItem("chek_orders_v1")) || [];
        localOrders.unshift(orderPayload);
        localStorage.setItem("chek_orders_v1", JSON.stringify(localOrders));
      } catch (e) {}

      // If Firestore is ready, save to cloud
      if (isReady && db) {
        try {
          const docRef = await db.collection("orders").add(orderPayload);
          console.log("🌿 [Firebase DB] Order saved to Firestore with ID:", docRef.id);
          return { success: true, cloudId: docRef.id };
        } catch (err) {
          console.error("🌿 [Firebase DB] Order cloud sync failed:", err);
          return { success: false, error: err.message };
        }
      }

      return { success: true, localOnly: true };
    },

    /**
     * Get orders for the logged-in customer
     * @param {string} email
     */
    async getUserOrders(email) {
      const orders = [];
      // 1. Try fetching from Firestore
      if (isReady && db && email) {
        try {
          const snap = await db
            .collection("orders")
            .where("userEmail", "==", email.toLowerCase().trim())
            .get();
          snap.forEach((doc) => orders.push({ id: doc.id, ...doc.data() }));
          if (orders.length > 0) return orders;
        } catch (err) {
          console.warn("🌿 [Firebase DB] Fetch user orders failed:", err.message);
        }
      }

      // 2. Fallback to localStorage orders
      try {
        const local = JSON.parse(localStorage.getItem("chek_orders_v1")) || [];
        return local.filter(
          (o) => !email || (o.customer && o.customer.email && o.customer.email.toLowerCase() === email.toLowerCase())
        );
      } catch (e) {
        return [];
      }
    },

    /**
     * Search and track an order by Order ID, Phone number, or Email
     * @param {string} query
     */
    async trackOrder(query) {
      if (!query) throw new Error("Please enter your Order ID or Mobile Number.");
      const cleanQ = query.trim().replace(/^#/, "");
      let foundOrder = null;
      const matches = (o) => {
        const oId = (o.orderId || "").replace(/^#/, "").toLowerCase();
        const q = cleanQ.toLowerCase();
        const phone = o.customer && o.customer.mobile ? String(o.customer.mobile).replace(/\D/g, "") : "";
        const email = o.customer && o.customer.email ? o.customer.email.toLowerCase() : "";
        const qDigits = q.replace(/\D/g, "");
        return oId === q || oId === "chek-" + q || (qDigits.length >= 10 && phone === qDigits.slice(-10)) || email === q;
      };

      // firestore.rules only lets customers read their own orders, so a signed-in
      // shopper is matched against their own history first
      const me = auth ? auth.currentUser : null;
      if (isReady && db && me && me.email) {
        try {
          foundOrder = (await FirebaseDB.getUserOrders(me.email)).find(matches) || null;
        } catch (e) {}
      }

      // 1. Check Cloud Firestore if ready (open queries succeed for the admin only)
      if (!foundOrder && isReady && db) {
        try {
          // Check by orderId
          let snap = await db.collection("orders").where("orderId", "==", cleanQ).limit(1).get();
          if (snap.empty) {
            snap = await db.collection("orders").where("orderId", "==", "CHEK-" + cleanQ).limit(1).get();
          }
          // Check by phone number
          if (snap.empty) {
            const numOnly = cleanQ.replace(/\D/g, "");
            if (numOnly.length >= 10) {
              snap = await db.collection("orders").where("customer.mobile", "==", numOnly.slice(-10)).limit(1).get();
            }
          }
          // Check by email
          if (snap.empty && cleanQ.includes("@")) {
            snap = await db.collection("orders").where("customer.email", "==", cleanQ.toLowerCase()).limit(1).get();
          }

          if (!snap.empty) {
            foundOrder = { id: snap.docs[0].id, ...snap.docs[0].data() };
          }
        } catch (err) {
          console.warn("Track order query error:", err.message);
        }
      }

      // 2. Check LocalStorage fallback
      if (!foundOrder) {
        try {
          const localOrders = JSON.parse(localStorage.getItem("chek_orders_v1")) || [];
          foundOrder = localOrders.find(matches);
        } catch (e) {}
      }

      if (!foundOrder) {
        throw new Error("No order found with '" + cleanQ + "'. Please check your Order ID or Mobile Number.");
      }

      return foundOrder;
    },

    // -------------------------------- REVIEWS -------------------------------
    /**
     * Save product review to Firestore
     * @param {string} handle
     * @param {Object} reviewData
     */
    async saveReview(handle, reviewData) {
      const currentUser = auth ? auth.currentUser : null;
      const reviewPayload = {
        productHandle: handle,
        userId: currentUser ? currentUser.uid : null,
        ...reviewData,
        createdAt: new Date().toISOString()
      };

      if (isReady && db) {
        try {
          const docRef = await db.collection("reviews").add(reviewPayload);
          console.log("🌿 [Firebase DB] Review saved to Firestore:", docRef.id);
          return { success: true, id: docRef.id };
        } catch (err) {
          console.error("🌿 [Firebase DB] Review cloud save failed:", err);
          return { success: false, error: err.message };
        }
      }
      return { success: true, localOnly: true };
    },

    /**
     * Fetch all remote reviews for a specific product handle
     * @param {string} handle
     */
    async getProductReviews(handle) {
      if (!isReady || !db) return [];
      try {
        const snapshot = await db
          .collection("reviews")
          .where("productHandle", "==", handle)
          .get();

        const reviews = [];
        snapshot.forEach((doc) => {
          reviews.push({ id: doc.id, ...doc.data() });
        });
        return reviews;
      } catch (err) {
        console.warn("🌿 [Firebase DB] Fetch reviews failed:", err.message);
        return [];
      }
    },

    /**
     * Fetch every product review once (for star ratings across the catalog)
     */
    async getAllReviews() {
      if (!isReady || !db) return [];
      try {
        const snapshot = await db.collection("reviews").limit(1000).get();
        const reviews = [];
        snapshot.forEach((doc) => reviews.push({ ...doc.data(), docId: doc.id }));
        return reviews;
      } catch (err) {
        console.warn("🌿 [Firebase DB] Fetch all reviews failed:", err.message);
        return [];
      }
    },

    // -------------------------------- PRODUCTS ------------------------------
    // admin.html edits products Shopify-style; each edited or added product is one
    // document in `products`, keyed by its handle, layered over the store catalog by app.js

    /**
     * All product edits, as { handle: doc }
     */
    async getProductOverrides() {
      if (!isReady || !db) return null;
      try {
        const snap = await db.collection("products").get();
        const map = {};
        snap.forEach((doc) => { map[doc.id] = { ...doc.data(), handle: doc.id }; });
        return map;
      } catch (err) {
        console.warn("🌿 [Firebase DB] Fetch product edits failed:", err.message);
        return null;
      }
    },

    /**
     * Create or replace a product's edits (admin only — enforced by firestore.rules)
     * @param {string} handle
     * @param {Object} data
     */
    async saveProduct(handle, data) {
      if (!db) throw new Error("Cloud Firestore is not connected.");
      const payload = { ...data, handle, updatedAt: new Date().toISOString(), updatedBy: auth && auth.currentUser ? auth.currentUser.email : null };
      await db.collection("products").doc(handle).set(payload);
      return payload;
    },

    /**
     * Remove a product's edits document entirely (reverts to store data, or drops an added product)
     * @param {string} handle
     */
    async removeProductOverride(handle) {
      if (!db) throw new Error("Cloud Firestore is not connected.");
      await db.collection("products").doc(handle).delete();
    },

    /**
     * Upload a product image to Firebase Storage and return its public URL
     * @param {Blob} blob
     * @param {string} handle
     * @param {string} name
     */
    async uploadProductImage(blob, handle, name) {
      if (typeof firebase === "undefined" || !firebase.storage) throw new Error("Firebase Storage is not loaded.");
      const safe = String(name || "image").toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
      const ref = firebase.storage().ref().child("products/" + handle + "/" + Date.now() + "-" + safe);
      await ref.put(blob, { contentType: blob.type || "image/webp", cacheControl: "public, max-age=31536000" });
      return ref.getDownloadURL();
    },

    // -------------------------------- NEWSLETTER ----------------------------
    /**
     * Save newsletter subscriber email
     * @param {string} email
     */
    async saveNewsletter(email) {
      if (!email) return { success: false };

      const subPayload = {
        email: email.trim().toLowerCase(),
        subscribedAt: new Date().toISOString()
      };

      if (isReady && db) {
        try {
          await db.collection("subscribers").add(subPayload);
          console.log("🌿 [Firebase DB] Newsletter subscriber saved to Firestore!");
          return { success: true };
        } catch (err) {
          console.warn("🌿 [Firebase DB] Newsletter sync failed:", err.message);
          return { success: false, error: err.message };
        }
      }
      return { success: true, localOnly: true };
    }
  };

  window.FirebaseDB = FirebaseDB;
})();
