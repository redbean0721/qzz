<template>
  <div class="flex min-h-dvh flex-col">
    <header class="border-b border-default">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <NuxtLink to="/" class="font-mono text-xl font-bold">
          qzz<span class="text-primary">.tw</span>
        </NuxtLink>
        <UColorModeButton />
      </div>
    </header>

    <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <slot />
    </main>

    <footer class="border-t border-default">
      <p class="mx-auto max-w-3xl px-4 py-4 text-center text-xs text-muted sm:text-left">
        <!-- 手機置中、連結換到下一行；桌面靠左接在同一行 -->
        qzz.tw — 免登入的短網址與貼文服務。請勿用於散布惡意或違法內容。
        <span class="mt-1 block sm:mt-0 sm:ml-1 sm:inline">
          <NuxtLink to="/privacy" class="underline">隱私權政策</NuxtLink>
          <a href="/third-party-notices.txt" class="ml-1 underline">開放原始碼授權</a>
        </span>
      </p>
    </footer>
  </div>
</template>
