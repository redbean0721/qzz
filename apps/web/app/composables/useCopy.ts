export function useCopy() {
  const toast = useToast()

  // quiet：自動複製（設定裡的「建立後自動複製」）失敗時不跳錯誤，結果卡片上還有複製按鈕
  return async function copy(text: string, label = '已複製', { quiet = false } = {}) {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ title: label, icon: 'i-lucide-check', color: 'success', duration: 1500 })
    } catch {
      if (!quiet) toast.add({ title: '無法複製，請手動選取', color: 'error' })
    }
  }
}
