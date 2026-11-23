import { redirect } from "next/navigation";

/** My vouchers is its own page now; keep the old address working. */
export default function AccountVouchersRedirect() {
  redirect("/vouchers");
}
