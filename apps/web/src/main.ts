import { createPinia } from 'pinia';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElProgress,
  ElSkeleton,
} from 'element-plus';
import { createApp } from 'vue';
import 'element-plus/es/components/alert/style/css';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/form/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/progress/style/css';
import 'element-plus/es/components/skeleton/style/css';

import App from './App.vue';
import { router } from './router';
import i18n from './i18n';
import './style.css';
import { useAuthStore } from './stores/auth';

const pinia = createPinia();

createApp(App)
  .use(pinia)
  .use(router)
  .use(i18n)
  .component('ElAlert', ElAlert)
  .component('ElButton', ElButton)
  .component('ElForm', ElForm)
  .component('ElFormItem', ElFormItem)
  .component('ElInput', ElInput)
  .component('ElProgress', ElProgress)
  .component('ElSkeleton', ElSkeleton)
  .mount('#app');

useAuthStore(pinia).bindSessionSync(() => {
  const currentRoute = router.currentRoute.value;
  if (currentRoute.meta.requiresAuth) {
    router.push({ name: 'login', query: { redirect: currentRoute.fullPath } });
  }
});
