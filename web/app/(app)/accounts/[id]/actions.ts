"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const RESULTS = ["NO_REPLY", "REPLY", "MEETING"] as const;

export async function logResult(formData: FormData) {
  const user = await requireUser();
  const companyId = String(formData.get("companyId"));
  const contactId = String(formData.get("contactId") || "") || null;
  const result = RESULTS.find((r) => r === formData.get("result"));
  if (!result) throw new Error("Unknown result");
  const account = await prisma.company.findUnique({ where: { id: companyId } });
  // The group comes from the account, not from the form, so the test stays clean.
  if (!account?.emailGroup) throw new Error("Unknown account");
  if (contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, rootId: companyId } });
    if (!contact) throw new Error("The contact does not belong to this account");
  }
  const note = String(formData.get("note") || "").slice(0, 500) || null;
  await prisma.activity.create({ data: { companyId, contactId, result, angle: account.emailGroup, note, userEmail: user.email } });
  revalidatePath(`/accounts/${companyId}`);
  revalidatePath("/");
}
