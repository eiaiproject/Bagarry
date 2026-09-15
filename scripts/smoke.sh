#!/usr/bin/env bash
# Smoke test alur utama: papan publik, auth, upload bukti, verifikasi, tolak,
# pengeluaran, laporan, dan pemeriksaan hak akses.
#
# Pakai: bash scripts/smoke.sh [base_url]
set -u

BASE="${1:-http://127.0.0.1:8787}"
WORK="$(mktemp -d)"
ADMIN_JAR="$WORK/admin.jar"
WARGA_JAR="$WORK/warga.jar"
OTHER_JAR="$WORK/other.jar"
BODY="$WORK/body.html"
JSON="$WORK/body.json"

pass=0
fail=0

pass_msg() { echo "PASS  $1"; pass=$((pass + 1)); }
fail_msg() { echo "FAIL  $1"; fail=$((fail + 1)); }
check() { if [ "$2" = "1" ]; then pass_msg "$1"; else fail_msg "$1"; fi; }
expect_eq() { if [ "$2" = "$3" ]; then pass_msg "$1"; else fail_msg "$1 (harap $2, dapat ${3:-kosong})"; fi; }

contains() { grep -q -- "$2" "$1" && echo 1 || echo 0; }
is_redirect() { case "$1" in 302 | 303) echo 1 ;; *) echo 0 ;; esac; }
json() { node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);console.log(o$1)})" 2>/dev/null; }

get() { curl -s -o "$BODY" -w '%{http_code}' -b "$2" "$BASE$1"; }
get_anon() { curl -s -o "$BODY" -w '%{http_code}' "$BASE$1"; }
post_form() { curl -s -o "$BODY" -D "$WORK/headers" -w '%{http_code}' -b "$3" -c "$3" -X POST "$BASE$1" -d "$2"; }
post_json() { curl -s -o "$JSON" -D "$WORK/headers" -w '%{http_code}' -b "$3" -c "$3" -X POST "$BASE$1" -H 'content-type: application/json' -d "$2"; }

redirect_target() { grep -i '^location:' "$WORK/headers" | tr -d '\r' | awk '{print $2}'; }

month_shift() {
  node -e "const [y,m]=process.argv[1].split('-').map(Number);const d=new Date(Date.UTC(y,m-1+Number(process.argv[2]),1));console.log(d.toISOString().slice(0,7))" "$1" "$2"
}

CUR_MONTH=$(node -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit'}).format(new Date()))")
START_MONTH=$(month_shift "$CUR_MONTH" -2)
M1="$START_MONTH"
M2=$(month_shift "$START_MONTH" 1)
M3=$(month_shift "$START_MONTH" 2)

echo "== Papan publik =="
code=$(get_anon "/")
check "GET / mengembalikan 200" "$([ "$code" = "200" ] && echo 1 || echo 0)"
check "Papan menampilkan saldo kas" "$(contains "$BODY" 'Saldo kas')"
check "Papan tidak menampilkan nama pemilik" "$(grep -q 'Budi' "$BODY" && echo 0 || echo 1)"

code=$(curl -s -o "$JSON" -w '%{http_code}' "$BASE/api/public/summary")
BALANCE_START=$(cat "$JSON" | json '.balance')
ACTIVE0=$(cat "$JSON" | json '.counts.active')
check "GET /api/public/summary mengembalikan saldo" "$([ "$code" = "200" ] && [ -n "$BALANCE_START" ] && echo 1 || echo 0)"
check "Rekap rumah aktif terbaca" "$(cat "$JSON" | json '.counts.active >= 0 ? 1 : 0')"

echo "== Login bendahara dan wajib ganti password =="
code=$(post_form "/login" "identifier=bendahara@bagarry.id&password=Bagarry%23Admin" "$ADMIN_JAR")
check "Login administratif dialihkan ke halaman ganti password" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"
check "Target redirect /ganti-password" "$([ "$(redirect_target)" = "/ganti-password" ] && echo 1 || echo 0)"

code=$(get "/admin" "$ADMIN_JAR")
check "Menu admin terkunci sebelum password diganti" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"

code=$(post_form "/ganti-password" "current=Bagarry%23Admin&next=BagarryAdmin2026&confirm=BagarryAdmin2026" "$ADMIN_JAR")
check "Ganti password default berhasil" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"

code=$(get "/admin" "$ADMIN_JAR")
check "Dashboard bendahara terbuka" "$([ "$code" = "200" ] && [ "$(contains "$BODY" 'Dashboard bendahara')" = "1" ] && echo 1 || echo 0)"

echo "== Rate limit login =="
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$BASE/login" -d "identifier=uji-limit@example.com&password=salah"
done
curl -s -o /dev/null -D "$WORK/headers" -X POST "$BASE/login" -d "identifier=uji-limit@example.com&password=salah"
check "Percobaan login ke-6 dibatasi" "$(grep -qi 'terlalu' "$WORK/headers" && echo 1 || echo 0)"

echo "== Pengaturan iuran =="
# Nilai awal dibaca lebih dulu supaya pemeriksaan tetap sahih walau database sudah berisi
# data contoh: yang diuji adalah selisih yang disebabkan aksi smoke, bukan angka mutlak.
OLD_OPEN=$(curl -s -b "$ADMIN_JAR" "$BASE/api/admin/settings" | json '.settings.openingBalance')
REPORT0=$(curl -s -b "$ADMIN_JAR" "$BASE/api/admin/reports/monthly?month=$CUR_MONTH")
INCOME0=$(echo "$REPORT0" | json '.income')
EXPENSE0=$(echo "$REPORT0" | json '.expense')
code=$(post_form "/admin/settings" "monthlyFee=Rp50.000&openingBalance=1000000&openingBalanceDate=${START_MONTH}-01&globalBillingStartMonth=${START_MONTH}" "$ADMIN_JAR")
check "Pengaturan tersimpan" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"
code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$ADMIN_JAR" "$BASE/api/admin/settings")
check "Saldo awal terbaca 1000000" "$(cat "$JSON" | json '.settings.openingBalance === 1000000 ? 1 : 0')"
check "Bulan awal tagihan terbaca" "$(cat "$JSON" | json ".settings.globalBillingStartMonth === '${START_MONTH}' ? 1 : 0")"
BALANCE_AWAL=$(curl -s "$BASE/api/public/summary" | json '.balance')
expect_eq "Saldo papan mengikuti saldo awal baru" "$((BALANCE_START - OLD_OPEN + 1000000))" "$BALANCE_AWAL"

echo "== Kelola rumah =="
code=$(post_form "/admin/houses" "houseType=Lupine&block=C4/20&occupancyStatus=berpenghuni&isActive=1&ownerName=Budi" "$ADMIN_JAR")
check "Rumah baru dibuat" "$([ "$code" = "200" ] && [ "$(contains "$BODY" 'BagarryC4/20')" = "1" ] && echo 1 || echo 0)"

code=$(post_form "/admin/houses" "houseType=Lupine&block=C4/21&occupancyStatus=kosong&isActive=1&ownerName=Siti" "$ADMIN_JAR")
check "Rumah kedua dibuat" "$([ "$code" = "200" ] && echo 1 || echo 0)"

echo "== Import CSV =="
csv="jenis_rumah,blok,status_huni,aktif\nLupine,C4/22,kosong,0\nLupine,C4/23,tanah_kosong,0"
code=$(post_form "/admin/houses/import" "csv=$(printf '%b' "$csv")" "$ADMIN_JAR")
check "Pratinjau import menampilkan 2 rumah" "$(contains "$BODY" '2 rumah siap dibuat')"
code=$(post_form "/admin/houses/import/confirm" "csv=$(printf '%b' "$csv")" "$ADMIN_JAR")
check "Import CSV membuat rumah" "$(contains "$BODY" '2 rumah dibuat')"

code=$(curl -s -o "$JSON" -w '%{http_code}' "$BASE/api/public/summary")
check "Dua rumah aktif baru ikut terhitung" "$(cat "$JSON" | json ".counts.active === $((ACTIVE0 + 2)) ? 1 : 0")"

echo "== Login warga dan upload bukti =="
code=$(post_form "/login" "identifier=Lupine-C4/20&password=BagarryC4/20" "$WARGA_JAR")
check "Login warga memakai kode rumah" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"
code=$(post_form "/ganti-password" "current=BagarryC4/20&next=WargaC4-20baru&confirm=WargaC4-20baru" "$WARGA_JAR")
check "Warga mengganti password default" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"

code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$WARGA_JAR" "$BASE/api/warga/unpaid-months")
check "Tunggakan warga terbaca 3 bulan" "$(cat "$JSON" | json '.unpaidMonths.length === 3 ? 1 : 0')"
check "Nominal iuran per bulan 50000" "$(cat "$JSON" | json '.monthlyFee === 50000 ? 1 : 0')"

PENDING0=$(curl -s -b "$ADMIN_JAR" "$BASE/api/admin/payments/pending" | json '.payments.length')

echo "transfer" > "$WORK/bukti.png"
echo "bukan gambar" > "$WORK/salah.txt"

code=$(curl -s -o /dev/null -D "$WORK/headers" -w '%{http_code}' -b "$WARGA_JAR" -c "$WARGA_JAR" \
  -X POST "$BASE/warga/pembayaran" -F "months=$M1" -F "proof=@$WORK/salah.txt;type=text/plain")
check "Format file selain JPG/PNG/PDF ditolak" "$([ "$(is_redirect "$code")" = "1" ] && grep -qi 'format' "$WORK/headers" && echo 1 || echo 0)"
code=$(curl -s -o /dev/null -D "$WORK/headers" -w '%{http_code}' -b "$WARGA_JAR" -c "$WARGA_JAR" \
  -X POST "$BASE/warga/pembayaran" -F "months=$M3" -F "proof=@$WORK/bukti.png;type=image/png")
check "Bulan yang melompat ditolak" "$([ "$(is_redirect "$code")" = "1" ] && grep -qi 'berurutan' "$WORK/headers" && echo 1 || echo 0)"

code=$(curl -s -o "$BODY" -D "$WORK/headers" -w '%{http_code}' -b "$WARGA_JAR" -c "$WARGA_JAR" \
  -X POST "$BASE/warga/pembayaran" \
  -F "months=$M1" -F "months=$M2" -F "note=Transfer dari BCA" -F "proof=@$WORK/bukti.png;type=image/png")
check "Upload bukti 2 bulan diterima" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"
PAYMENT_ID=$(redirect_target | sed -n 's|.*id=\([0-9]*\).*|\1|p')
check "Redirect membawa id pengajuan" "$([ -n "$PAYMENT_ID" ] && echo 1 || echo 0)"

code=$(curl -s -o "$JSON" -w '%{http_code}' "$BASE/api/public/summary")
BALANCE_PENDING=$(cat "$JSON" | json '.balance')
expect_eq "Saldo belum berubah saat masih pending" "$BALANCE_AWAL" "$BALANCE_PENDING"

code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$ADMIN_JAR" "$BASE/api/admin/payments/pending")
check "Unggahan gagal tidak membuat pengajuan" "$(cat "$JSON" | json ".payments.length === $((PENDING0 + 1)) ? 1 : 0")"
check "Pengajuan masuk daftar menunggu verifikasi" "$(cat "$JSON" | json ".payments.some(p => p.id === $PAYMENT_ID) ? 1 : 0")"
check "Item bulan tersimpan pada pengajuan" "$(cat "$JSON" | json ".payments.find(p => p.id === $PAYMENT_ID).months.length === 2 ? 1 : 0")"
PROOF_ID=$(cat "$JSON" | json ".payments.find(p => p.id === $PAYMENT_ID).proof_file_id")

code=$(curl -s -o "$BODY" -w '%{http_code}' -b "$WARGA_JAR" "$BASE/api/files/$PROOF_ID")
check "Pemilik dapat membuka buktinya" "$([ "$code" = "200" ] && echo 1 || echo 0)"
code=$(get_anon "/api/files/$PROOF_ID")
check "Bukti tidak bisa diakses tanpa login" "$([ "$code" = "401" ] && echo 1 || echo 0)"

echo "== Verifikasi pembayaran =="
code=$(post_json "/api/admin/payments/$PAYMENT_ID/approve" '{}' "$ADMIN_JAR")
check "Approve berhasil" "$([ "$code" = "200" ] && echo 1 || echo 0)"
code=$(curl -s -o "$JSON" -w '%{http_code}' "$BASE/api/public/summary")
BALANCE_VERIFIED=$(cat "$JSON" | json '.balance')
expect_eq "Saldo bertambah setelah approve" "$((BALANCE_PENDING + 100000))" "$BALANCE_VERIFIED"

code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$WARGA_JAR" "$BASE/api/warga/me")
check "Tunggakan tinggal bulan terakhir" "$(cat "$JSON" | json ".unpaidMonths.length === 1 && o.unpaidMonths[0] === '${M3}' ? 1 : 0")"
check "paidUntil menunjuk bulan kedua" "$(cat "$JSON" | json ".paidUntil === '${M2}' ? 1 : 0")"

code=$(post_json "/api/admin/payments/$PAYMENT_ID/approve" '{}' "$ADMIN_JAR")
check "Approve kedua kali ditolak" "$([ "$code" = "400" ] && echo 1 || echo 0)"

echo "== Tolak pembayaran =="
curl -s -o /dev/null -b "$WARGA_JAR" -c "$WARGA_JAR" -X POST "$BASE/warga/pembayaran" \
  -F "months=$M3" -F "proof=@$WORK/bukti.png;type=image/png"
REJECT_ID=$(curl -s -b "$ADMIN_JAR" "$BASE/api/admin/payments/pending" | json '.payments[0].id')
code=$(post_json "/api/admin/payments/$REJECT_ID/reject" '{"reason":"Nominal transfer tidak sesuai"}' "$ADMIN_JAR")
check "Reject berhasil" "$([ "$code" = "200" ] && echo 1 || echo 0)"
code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$WARGA_JAR" "$BASE/api/warga/me")
check "Bulan yang ditolak kembali menjadi tunggakan" "$(cat "$JSON" | json ".unpaidMonths.length === 1 && o.unpaidMonths[0] === '${M3}' ? 1 : 0")"
code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$WARGA_JAR" "$BASE/api/warga/payments")
check "Alasan penolakan terbaca warga" "$(cat "$JSON" | json ".payments.some(p => p.status === 'rejected' && p.rejected_reason.includes('tidak sesuai')) ? 1 : 0")"

echo "== Pengeluaran =="
code=$(post_json "/api/admin/expenses" '{"expenseDate":"'"$CUR_MONTH"'-10","description":"Perbaikan lampu jalan blok C","amount":350000}' "$ADMIN_JAR")
check "Pengeluaran tersimpan" "$([ "$code" = "201" ] && echo 1 || echo 0)"
code=$(curl -s -o "$JSON" -w '%{http_code}' "$BASE/api/public/summary")
BALANCE_EXPENSE=$(cat "$JSON" | json '.balance')
expect_eq "Saldo berkurang setelah pengeluaran" "$((BALANCE_VERIFIED - 350000))" "$BALANCE_EXPENSE"
check "Pengeluaran masuk bulan berjalan" "$(cat "$JSON" | json ".expense === $((EXPENSE0 + 350000)) ? 1 : 0")"

echo "== Laporan =="
code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$ADMIN_JAR" "$BASE/api/admin/reports/monthly?month=$CUR_MONTH")
check "Laporan bulanan tersedia" "$([ "$code" = "200" ] && echo 1 || echo 0)"
check "Laporan menambah pemasukan 100000" "$(cat "$JSON" | json ".income === $((INCOME0 + 100000)) ? 1 : 0")"
check "Laporan menambah pengeluaran 350000" "$(cat "$JSON" | json ".expense === $((EXPENSE0 + 350000)) ? 1 : 0")"
check "Saldo akhir laporan konsisten" "$(cat "$JSON" | json '.closingBalance === o.openingBalance + o.income - o.expense ? 1 : 0')"

echo "== Hak akses =="
code=$(get "/admin" "$WARGA_JAR")
check "Warga tidak bisa membuka menu admin" "$([ "$(is_redirect "$code")" = "1" ] && echo 1 || echo 0)"
code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$WARGA_JAR" "$BASE/api/admin/summary")
check "API admin menolak warga" "$([ "$code" = "403" ] && echo 1 || echo 0)"

curl -s -o /dev/null -b "$OTHER_JAR" -c "$OTHER_JAR" -X POST "$BASE/login" \
  -d "identifier=Lupine-C4/21&password=BagarryC4/21"
curl -s -o /dev/null -b "$OTHER_JAR" -c "$OTHER_JAR" -X POST "$BASE/ganti-password" \
  -d "current=BagarryC4/21&next=WargaC4-21baru&confirm=WargaC4-21baru"
code=$(curl -s -o "$BODY" -w '%{http_code}' -b "$OTHER_JAR" "$BASE/api/files/$PROOF_ID")
check "Warga lain tidak bisa membuka bukti rumah lain" "$([ "$code" = "403" ] && echo 1 || echo 0)"
code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$OTHER_JAR" "$BASE/api/warga/me")
check "Warga hanya melihat rumah sendiri" "$(cat "$JSON" | json ".house.block === 'C4/21' ? 1 : 0")"

echo "== Audit log =="
code=$(curl -s -o "$JSON" -w '%{http_code}' -b "$ADMIN_JAR" "$BASE/api/admin/audit")
check "Audit log berisi approve_payment" "$(cat "$JSON" | json ".logs.some(l => l.action === 'approve_payment') ? 1 : 0")"
check "Audit log berisi reject_payment" "$(cat "$JSON" | json ".logs.some(l => l.action === 'reject_payment') ? 1 : 0")"
check "Audit log berisi create_expense" "$(cat "$JSON" | json ".logs.some(l => l.action === 'create_expense') ? 1 : 0")"
check "Audit log berisi login" "$(cat "$JSON" | json ".logs.some(l => l.action === 'login') ? 1 : 0")"

echo "== Semua halaman render tanpa nilai rusak =="
code=$(get_anon "/login")
check "GET /login terbuka untuk publik" "$([ "$code" = "200" ] && echo 1 || echo 0)"
code=$(get "/login" "$ADMIN_JAR")
check "GET /login mengalihkan pengguna yang sudah masuk" "$(is_redirect "$code")"
for path in / /ganti-password /admin /admin/houses /admin/houses/new /admin/houses/import /admin/houses/1 /admin/payments /admin/payments/pending /admin/expenses /admin/expenses/1 /admin/reports /admin/settings /admin/audit /admin/password; do
  code=$(get "$path" "$ADMIN_JAR")
  check "GET $path merespons 200" "$([ "$code" = "200" ] && echo 1 || echo 0)"
  check "GET $path tidak menampilkan undefined atau NaN" "$(grep -qE 'undefined|NaN' "$BODY" && echo 0 || echo 1)"
done
for path in /warga /warga/pembayaran /warga/riwayat /warga/password; do
  code=$(get "$path" "$WARGA_JAR")
  check "GET $path merespons 200" "$([ "$code" = "200" ] && echo 1 || echo 0)"
  check "GET $path tidak menampilkan undefined atau NaN" "$(grep -qE 'undefined|NaN' "$BODY" && echo 0 || echo 1)"
done

echo
echo "Ringkasan: ${pass} pass, ${fail} fail"
rm -rf "$WORK"
[ "$fail" -eq 0 ]
