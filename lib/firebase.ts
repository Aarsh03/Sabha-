import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import type { ErrorLike } from './types';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  Auth,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

interface FirebaseConfigOptions {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

function getActiveFirebaseConfig(): FirebaseConfigOptions | null {
  // 1. Check process.env first
  const envConfig: FirebaseConfigOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || '',
  };

  if (envConfig.apiKey && envConfig.projectId) {
    return envConfig;
  }

  // 2. Check localStorage (allows user to paste config directly in web UI)
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('sabha_firebase_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.apiKey && parsed.projectId) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

import { initializeFirestore } from 'firebase/firestore';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const currentConfig = getActiveFirebaseConfig();

if (currentConfig) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(currentConfig);
    auth = getAuth(app);
    if (typeof window !== 'undefined') {
      setPersistence(auth, browserLocalPersistence).catch((err) => {
        console.warn('Firebase persistence warning:', err);
      });
    }
    try {
      db = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
      });
    } catch {
      db = getFirestore(app);
    }
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

export { auth, db };

export const isFirebaseConfigured = (): boolean => {
  return app !== null && db !== null;
};

export async function loginWithGoogle() {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized. Please provide Firebase credentials.');
  }
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.warn('Popup sign-in notice:', (err as ErrorLike)?.code || err);
    // If the user closed the popup or cancelled, do not force a redirect
    if (
      (err as ErrorLike)?.code === 'auth/popup-closed-by-user' ||
      (err as ErrorLike)?.code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }
    // If popup was blocked by browser, attempt redirect fallback
    if ((err as ErrorLike)?.code === 'auth/popup-blocked') {
      return await signInWithRedirect(auth, googleProvider);
    }
    throw err;
  }
}

export async function loginWithGoogleRedirect() {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized. Please provide Firebase credentials.');
  }
  return await signInWithRedirect(auth, googleProvider);
}

export async function logoutUser() {
  if (!auth) return;
  return await signOut(auth);
}
