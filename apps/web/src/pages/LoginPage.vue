<template>
  <div class="page-shell min-h-screen px-4 py-6 sm:px-6">
    <div class="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <section class="glass-panel-strong flex flex-col justify-between rounded-[2.4rem] p-8 md:p-10">
        <div>
          <div class="flex items-center justify-between gap-3">
            <router-link to="/" class="flex items-center gap-3">
              <div class="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--page-ink)] text-xs font-bold tracking-[0.24em] text-white">
                FO
              </div>
              <div>
                <p class="text-xs uppercase tracking-[0.28em] text-[var(--muted-ink)]">FluentOps</p>
                <p class="text-sm text-[var(--soft-ink)]">{{ $t('nav.coach') }}</p>
              </div>
            </router-link>
          </div>

          <p class="section-kicker mt-10">{{ $t('auth.login') }}</p>
          <h1 class="mt-3 text-4xl font-semibold leading-tight text-[var(--page-ink)] md:text-5xl">
            {{ $t('home.hero.title') }}
          </h1>
          <p class="mt-5 max-w-xl text-sm leading-8 text-[var(--muted-ink)] md:text-base">
            {{ $t('home.hero.desc') }}
          </p>
        </div>

        <div class="mt-10 grid gap-4 md:grid-cols-3">
          <div class="rounded-[1.6rem] border border-black/8 bg-white/76 p-4">
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--soft-ink)]">{{ $t('nav.speaking') }}</p>
            <p class="mt-3 text-sm leading-7 text-[var(--muted-ink)]">{{ $t('home.features.speakingDesc') }}</p>
          </div>
          <div class="rounded-[1.6rem] border border-black/8 bg-white/76 p-4">
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--soft-ink)]">{{ $t('nav.coach') }}</p>
            <p class="mt-3 text-sm leading-7 text-[var(--muted-ink)]">{{ $t('home.features.coachDesc') }}</p>
          </div>
          <div class="rounded-[1.6rem] border border-black/8 bg-white/76 p-4">
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--soft-ink)]">{{ $t('nav.billing') }}</p>
            <p class="mt-3 text-sm leading-7 text-[var(--muted-ink)]">{{ $t('home.features.creditsDesc') }}</p>
          </div>
        </div>
      </section>

      <section class="glass-panel rounded-[2.4rem] p-8 md:p-10">
        <div class="mx-auto max-w-md">
          <p class="section-kicker">{{ $t('auth.login') }}</p>
          <h2 class="mt-3 text-3xl font-semibold text-[var(--page-ink)]">{{ $t('auth.login') }}</h2>

          <el-form ref="formRef" :model="form" :rules="rules" class="mt-8 space-y-2" @submit.prevent="handleSubmit">
            <el-form-item prop="email">
              <el-input v-model="form.email" :placeholder="$t('auth.email')" type="email" size="large" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="form.password" :placeholder="$t('auth.password')" type="password" show-password size="large" />
            </el-form-item>
            <el-form-item class="!mb-0">
              <el-button
                type="primary"
                native-type="submit"
                :loading="loading"
                class="!mt-3 !w-full !rounded-full !border-0 !bg-[var(--page-ink)] !py-3 !text-sm !font-semibold"
                size="large"
              >
                {{ $t('auth.login') }}
              </el-button>
            </el-form-item>
          </el-form>

          <div class="mt-6 text-center text-sm text-[var(--muted-ink)]">
            {{ $t('auth.noAccount') }}
            <router-link to="/register" class="font-semibold text-[var(--accent)] hover:text-[#0d695f]">
              {{ $t('auth.register') }}
            </router-link>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useAuthStore } from '../stores/auth';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ email: '', password: '' });

const rules = computed<FormRules>(() => ({
  email: [
    { required: true, message: t('auth.emailRequired'), trigger: 'blur' },
    { type: 'email', message: t('auth.emailInvalid'), trigger: 'blur' },
  ],
  password: [{ required: true, message: t('auth.passwordRequired'), trigger: 'blur' }],
}));

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  form.email = form.email.trim();
  loading.value = true;
  try {
    await authStore.login(form.email, form.password);
    router.push(getRedirectPath());
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || t('auth.loginFailed');
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}

function getRedirectPath() {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect;
  }

  return '/dashboard';
}
</script>
