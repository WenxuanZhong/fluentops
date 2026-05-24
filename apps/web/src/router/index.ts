import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../pages/HomePage.vue') },
    { path: '/login', name: 'login', component: () => import('../pages/LoginPage.vue') },
    { path: '/register', name: 'register', component: () => import('../pages/RegisterPage.vue') },
    { path: '/dashboard', name: 'dashboard', component: () => import('../pages/DashboardPage.vue'), meta: { requiresAuth: true } },
    { path: '/speaking', name: 'speaking', component: () => import('../pages/SpeakingPage.vue'), meta: { requiresAuth: true } },
    { path: '/coach', name: 'coach', component: () => import('../pages/CoachPage.vue'), meta: { requiresAuth: true } },
    { path: '/billing', name: 'billing', component: () => import('../pages/BillingPage.vue'), meta: { requiresAuth: true } },
  ],
});

router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();
  if (to.meta.requiresAuth) {
    const hasSession = await authStore.ensureSession();
    if (!hasSession) {
      next({ name: 'login', query: { redirect: to.fullPath } });
      return;
    }

    next();
    return;
  }

  if ((to.name === 'login' || to.name === 'register') && authStore.isAuthenticated) {
    next('/dashboard');
    return;
  }

  next();
});
