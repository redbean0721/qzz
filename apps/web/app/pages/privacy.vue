<script setup lang="ts">
// 內容要跟實際的資料處理一致：改了 API / 網站 / 擴充功能的資料流程時，記得一起更新這頁和 UPDATED_AT
const UPDATED_AT = '2026-10-10'

useSeoMeta({
  title: '隱私權政策 – qzz',
  description: 'qzz.tw 短網址、貼文服務與瀏覽器擴充功能的隱私權政策。',
})

const h2 = 'mt-10 mb-3 text-lg font-semibold'
const list = 'list-disc space-y-1.5 pl-5'
</script>

<template>
  <article class="text-sm leading-7 text-default">
    <h1 class="text-2xl font-bold">隱私權政策</h1>
    <p class="mt-1 text-muted">最後更新：{{ UPDATED_AT }}</p>

    <p class="mt-6">qzz.tw 是免登入的短網址與文字貼上服務，也提供 Chrome 和 Firefox 的瀏覽器擴充功能。這份政策說明我們會收集哪些資料、怎麼使用、保存多久，以及你可以怎麼刪除。我們不使用分析或廣告追蹤服務，也不會販售任何資料。</p>

    <h2 :class="h2">建立的內容是公開的</h2>
    <p>短網址和貼文<strong>任何知道網址的人都可以開啟</strong>。網址裡的代碼是隨機產生的，不容易被猜到，但它不是密碼。請不要把密碼、金鑰、個人資料或其他機密內容貼到 qzz.tw。</p>
    <p class="mt-3">把貼文網址貼到 Discord、Threads 等聊天或社群服務時，對方會讀取貼文的預覽：標題、開頭的一段文字，以及顯示開頭幾行內容的預覽圖。這些預覽可能會被對方的服務另外保存，貼文刪除或下架後也不一定會跟著消失。</p>

    <h2 :class="h2">我們保存的資料</h2>
    <p>當你建立短網址或貼文時，伺服器會保存：</p>
    <ul :class="list">
      <li>你送出的內容：原始網址，或貼文的文字和語言</li>
      <li>建立時間，以及你選擇的有效期限</li>
      <li>建立時的 IP 位址</li>
      <li>刪除碼的雜湊值。刪除碼本身只會回傳給你一次，我們不保存它</li>
    </ul>
    <p class="mt-3">當你在<NuxtLink to="/report" class="text-primary underline">檢舉頁面</NuxtLink>送出檢舉時，伺服器會保存被檢舉的短網址或貼文、你選擇的原因和補充說明、送出時間，以及你的 IP 位址。</p>
    <p class="mt-3">只是開啟短網址或貼文，不會在資料庫留下紀錄，也不會做點擊統計（伺服器的系統紀錄見下方「保存期限」）。</p>

    <h2 :class="h2">資料的用途</h2>
    <ul :class="list">
      <li>提供服務：轉址到原始網址、顯示貼文、讓你用刪除碼刪除</li>
      <li>防止濫用：依 IP 限制建立、刪除和檢舉的頻率；處理檢舉、下架違規內容時，用建立時的 IP 判斷是否為同一來源</li>
      <li>處理檢舉：管理員依檢舉內容判斷是否下架；檢舉者的 IP 用來避免同一來源重複或惡意檢舉，不會提供給被檢舉內容的建立者</li>
    </ul>

    <h2 :class="h2">保存期限</h2>
    <ul :class="list">
      <li>設定了有效期限的短網址和貼文，到期後立即無法存取，並在一小時內從資料庫刪除，連同建立時的 IP</li>
      <li>選擇「永久」的項目會一直保存，直到你用刪除碼刪除</li>
      <li>因違反使用規範被下架的內容會立即停止公開，但紀錄（包含建立時的 IP）可能會保留，作為處理濫用的依據</li>
      <li>檢舉紀錄（包含檢舉者的 IP）跟著被檢舉的內容保存：內容到期或被刪除時一併刪除；內容被下架時跟下架的紀錄一起保留</li>
      <li>用來限制頻率的計數只保存一分鐘</li>
      <li>短網址預覽頁讀到的目的地網站標題、描述和預覽圖網址，快取一小時</li>
      <li>API 會把每個請求（包含開啟短網址、讀取貼文）的網址和 IP 記在伺服器的系統紀錄中，只用於維運、排除問題和處理濫用，並隨系統紀錄的輪替自動清除</li>
    </ul>

    <h2 :class="h2">第三方服務</h2>
    <ul :class="list">
      <li>
        <strong>Cloudflare</strong>：網站和 API 的流量都經由 Cloudflare 傳送，網站本身也執行在 Cloudflare 上。Cloudflare 可能會為了安全防護設定必要的 cookie。</li>
      <li>
        <strong>Google Safe Browsing</strong>：建立短網址時，原始網址會送到 Google 檢查是否為已知的釣魚或惡意網站，被標記的網址無法縮短。貼文內容不會送給 Google。</li>
      <li>
        <strong>短網址預覽頁的目的地網站</strong>：開啟短網址的預覽頁（短網址後面加 <code>+</code>）時，我們的伺服器會去讀取目的地網頁的標題、描述和預覽圖網址，這個請求不帶你的任何資訊。預覽圖則由你的瀏覽器直接向該網站載入（不送出 referrer），所以該網站會看到你的 IP 位址。</li>
      <li>
        <strong>YouTube</strong>：短網址指向 YouTube 影片時，我們的伺服器會向 YouTube 查詢這部影片能不能嵌入其他網站（不帶你的任何資訊）。可以的話，預覽頁會直接嵌入 YouTube 的播放器（隱私強化模式的 youtube-nocookie.com），YouTube 會看到你的 IP 位址，觀看資料依 Google 的隱私權政策處理；不能嵌入的影片則跟其他網站一樣顯示預覽圖。</li>
    </ul>

    <h2 :class="h2">只存在你瀏覽器裡的資料</h2>
    <ul :class="list">
      <li>網站首頁的「這個瀏覽器建立過的」紀錄（包含刪除碼）存在瀏覽器的 localStorage，不會上傳。清除網站資料或換瀏覽器後，這些紀錄就會消失</li>
      <li>深色、淺色模式的偏好設定也存在瀏覽器裡</li>
      <li>我們不設定任何追蹤用的 cookie</li>
    </ul>

    <h2 :class="h2">瀏覽器擴充功能</h2>
    <ul :class="list">
      <li>只有在你按下「縮短」或「建立」時，擴充功能才會把你送出的網址或文字傳到 qzz.tw；它不會在背景讀取或傳送你的瀏覽紀錄</li>
      <li>讀取目前分頁網址、右鍵選單、讀取選取文字等權限，只用於把內容帶進擴充功能的視窗，讓你確認後再送出</li>
      <li>擴充功能建立過的連結、貼文和刪除碼，存在擴充功能的本機儲存空間，不會上傳；移除擴充功能時會一併刪除</li>
    </ul>

    <h2 :class="h2">刪除你的資料</h2>
    <ul :class="list">
      <li>用建立時的刪除碼，可以隨時刪除短網址或貼文。網站和擴充功能的紀錄列表都有刪除按鈕</li>
      <li>遺失刪除碼、想刪除自己建立的內容時，請到下方的聯絡管道提供網址，我們會協助處理</li>
      <li>要檢舉別人建立的濫用內容，請使用<NuxtLink to="/report" class="text-primary underline">檢舉頁面</NuxtLink></li>
    </ul>

    <h2 :class="h2">政策變更</h2>
    <p>這份政策更新時會修改本頁，並調整上方的「最後更新」日期。</p>

    <h2 :class="h2">聯絡我們</h2>
    <p>
      <a href="https://github.com/redbean0721/qzz/issues" target="_blank" rel="noopener" class="text-primary underline">github.com/redbean0721/qzz/issues</a>
    </p>
  </article>
</template>
