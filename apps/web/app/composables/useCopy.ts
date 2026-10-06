export function useCopy() {
  const toast = useToast()

  return async function copy(text: string, label = '已複製') {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ title: label, icon: 'i-lucide-check', color: 'success', duration: 1500 })
    } catch {
      toast.add({ title: '無法複製，請手動選取', color: 'error' })
    }
  }
}
