"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/app/actions";
import {
  approvePackAction, attachPackAction, createCaseStudyAction, createKitAction, createPackAction, createShareLinkAction, detachPackAction,
  purgeArchivedAssetsAction, revokeShareLinkAction, saveKitAction, setAssetStatusAction, setCaseStudyStatusAction, setKitStatusAction, updateCaseStudyAction, updatePackAction, uploadKitAssetAction,
} from "@/app/app/kits/actions";
import { FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { Input, Label, selectClassName, Textarea } from "@/components/ui/form-controls";
import { developmentStatusLabels, developmentStatuses, type KitContent } from "@/modules/kits/content";
import { packTemplates, packTemplateKeys } from "@/modules/kits/templates";

const idle: FormState = { status: "idle" };

type Option = Readonly<{ id: string; label: string }>;

function CheckList({ name, legend, options, selected = [] }: { name: string; legend: string; options: readonly Option[]; selected?: readonly string[] | undefined }) {
  if (options.length === 0) return <p className="text-sm text-muted-foreground">No {legend.toLowerCase()} available yet.</p>;
  return <fieldset className="grid gap-2"><legend className="text-sm font-medium">{legend}</legend>
    <div className="grid gap-1.5 sm:grid-cols-2">{options.map((option) => <label className="flex items-start gap-2 text-sm" key={option.id}><input className="mt-1" defaultChecked={selected.includes(option.id)} name={name} type="checkbox" value={option.id} /><span>{option.label}</span></label>)}</div>
  </fieldset>;
}

function Hidden({ values }: { values: Readonly<Record<string, string>> }) {
  return <>{Object.entries(values).map(([name, value]) => <input key={name} name={name} type="hidden" value={value} />)}</>;
}

/** A button-only form for one-click actions such as archive, approve and revoke. */
function ActionButton({ action, values, label, pendingLabel }: { action: (state: FormState, formData: FormData) => Promise<FormState>; values: Readonly<Record<string, string>>; label: string; pendingLabel: string }) {
  const [state, run] = useActionState(action, idle);
  return <form action={run} className="grid gap-2"><Hidden values={values} /><SubmitButton pendingLabel={pendingLabel}>{label}</SubmitButton><FormMessage state={state} /></form>;
}

// --- Documents -------------------------------------------------------------------------------

export function UploadAssetForm({ assetId, title }: { assetId?: string; title?: string }) {
  const [state, action] = useActionState(uploadKitAssetAction, idle);
  const id = assetId ? `upload-${assetId}` : "upload-new";
  return <form action={action} className="grid gap-3">
    {assetId ? <input name="assetId" type="hidden" value={assetId} /> : <div className="grid gap-2"><Label htmlFor={`${id}-title`}>Title <span className="text-muted-foreground">(optional)</span></Label><Input id={`${id}-title`} maxLength={160} name="title" /></div>}
    <div className="grid gap-2"><Label htmlFor={`${id}-file`}>{assetId ? `New version of ${title ?? "this document"}` : "PDF, PNG or JPEG (up to 4 MB)"}</Label><Input accept="application/pdf,image/png,image/jpeg" id={`${id}-file`} name="file" required type="file" /></div>
    <FormMessage state={state} /><SubmitButton pendingLabel="Uploading…">{assetId ? "Upload new version" : "Upload document"}</SubmitButton>
  </form>;
}

export const AssetStatusForm = ({ assetId, status }: { assetId: string; status: "archived" | "active" }) =>
  <ActionButton action={setAssetStatusAction} label={status === "archived" ? "Archive" : "Restore"} pendingLabel="Saving…" values={{ assetId, status }} />;

// --- Kits ------------------------------------------------------------------------------------

type KitFormProps = Readonly<{
  kit?: { id: string; name: string; currentVersion: number };
  content?: KitContent;
  caseStudies: readonly Option[];
  assets: readonly Option[];
}>;

export function KitForm({ kit, content, caseStudies, assets }: KitFormProps) {
  const [state, action] = useActionState(kit ? saveKitAction : createKitAction, idle);
  const capabilities = (content?.capabilities ?? []).map((group) => `${group.group}: ${group.items.join(", ")}`).join("\n");
  return <form action={action} className="grid gap-5">
    {kit ? <Hidden values={{ kitId: kit.id, expectedVersion: String(kit.currentVersion) }} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="kit-name">Kit name</Label><Input defaultValue={kit?.name ?? ""} id="kit-name" maxLength={120} minLength={2} name="name" required /></div>
      <div className="grid gap-2"><Label htmlFor="kit-display-name">Your name or studio</Label><Input defaultValue={content?.profile.displayName ?? ""} id="kit-display-name" maxLength={120} minLength={2} name="displayName" required /></div>
    </div>
    <div className="grid gap-2"><Label htmlFor="kit-headline">Headline</Label><Input defaultValue={content?.profile.headline ?? ""} id="kit-headline" maxLength={160} name="headline" placeholder="Full-stack engineer building secure SaaS" /></div>
    <div className="grid gap-2"><Label htmlFor="kit-intro">Professional introduction</Label><Textarea defaultValue={content?.introduction ?? ""} id="kit-intro" maxLength={2000} name="introduction" /></div>
    <div className="grid gap-2"><Label htmlFor="kit-capabilities">Technical capabilities <span className="text-muted-foreground">(one group per line: Group: item, item)</span></Label><Textarea defaultValue={capabilities} id="kit-capabilities" name="capabilities" placeholder={"Backend: Node.js, PostgreSQL\nFrontend: React, Next.js"} /></div>
    <CheckList legend="Featured projects" name="featuredCaseStudyIds" options={caseStudies} selected={content?.featuredCaseStudyIds} />
    <div className="grid gap-2"><Label htmlFor="kit-approach">Architecture and engineering approach</Label><Textarea defaultValue={content?.approach ?? ""} id="kit-approach" maxLength={2500} name="approach" /></div>
    <div className="grid gap-2"><Label htmlFor="kit-services">Services and specialties <span className="text-muted-foreground">(one per line)</span></Label><Textarea defaultValue={(content?.services ?? []).join("\n")} id="kit-services" name="services" /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="kit-email">Contact email</Label><Input defaultValue={content?.contact.email ?? ""} id="kit-email" maxLength={254} name="email" type="email" /></div>
      <div className="grid gap-2"><Label htmlFor="kit-website">Website (https)</Label><Input defaultValue={content?.contact.website ?? ""} id="kit-website" maxLength={2048} name="website" type="url" /></div>
      <div className="grid gap-2"><Label htmlFor="kit-phone">Phone</Label><Input defaultValue={content?.contact.phone ?? ""} id="kit-phone" maxLength={40} name="phone" type="tel" /></div>
      <div className="grid gap-2"><Label htmlFor="kit-location">Location</Label><Input defaultValue={content?.contact.location ?? ""} id="kit-location" maxLength={120} name="location" /></div>
    </div>
    <CheckList legend="Supporting documents" name="attachmentAssetIds" options={assets} selected={content?.attachmentAssetIds} />
    <fieldset className="grid gap-3 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-medium">Branding</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2"><Label htmlFor="kit-wordmark">Wordmark</Label><Input defaultValue={content?.branding.wordmark ?? ""} id="kit-wordmark" maxLength={40} name="wordmark" placeholder="HOAX1G.DEV" /></div>
        <div className="grid gap-2"><Label htmlFor="kit-accent-1">Primary accent</Label><Input defaultValue={content?.branding.accentPrimary ?? ""} id="kit-accent-1" maxLength={7} name="accentPrimary" pattern="#[0-9A-Fa-f]{6}" placeholder="#8B5CF6" /></div>
        <div className="grid gap-2"><Label htmlFor="kit-accent-2">Secondary accent</Label><Input defaultValue={content?.branding.accentSecondary ?? ""} id="kit-accent-2" maxLength={7} name="accentSecondary" pattern="#[0-9A-Fa-f]{6}" placeholder="#22D3EE" /></div>
      </div>
    </fieldset>
    {kit ? <div className="grid gap-2"><Label htmlFor="kit-note">What changed <span className="text-muted-foreground">(optional)</span></Label><Input id="kit-note" maxLength={300} name="changeNote" /></div> : null}
    <FormMessage state={state} /><SubmitButton pendingLabel="Saving…">{kit ? "Save as new version" : "Create kit"}</SubmitButton>
  </form>;
}

export const KitStatusForm = ({ kitId, status }: { kitId: string; status: "archived" | "active" }) =>
  <ActionButton action={setKitStatusAction} label={status === "archived" ? "Archive kit" : "Restore kit"} pendingLabel="Saving…" values={{ kitId, status }} />;

// --- Case studies ----------------------------------------------------------------------------

type CaseStudyDefaults = Readonly<{
  id: string; projectName: string; problem: string; solution: string; techStack: readonly string[]; responsibilities: string; architectureSummary: string;
  repositoryUrl: string | null; demoUrl: string | null; results: string | null; resultsVerified: boolean; developmentStatus: string;
}>;

export function CaseStudyForm({ study, images, selectedImageIds }: { study?: CaseStudyDefaults; images?: readonly Option[]; selectedImageIds?: readonly string[] }) {
  const [state, action] = useActionState(study ? updateCaseStudyAction : createCaseStudyAction, idle);
  return <form action={action} className="grid gap-4">
    {study ? <input name="caseStudyId" type="hidden" value={study.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="cs-name">Project name</Label><Input defaultValue={study?.projectName ?? ""} id="cs-name" maxLength={160} minLength={2} name="projectName" required /></div>
      <div className="grid gap-2"><Label htmlFor="cs-status">Development status</Label><select className={selectClassName} defaultValue={study?.developmentStatus ?? "in_development"} id="cs-status" name="developmentStatus">{developmentStatuses.map((value) => <option key={value} value={value}>{developmentStatusLabels[value]}</option>)}</select></div>
    </div>
    <div className="grid gap-2"><Label htmlFor="cs-problem">Problem statement</Label><Textarea defaultValue={study?.problem ?? ""} id="cs-problem" maxLength={2000} name="problem" /></div>
    <div className="grid gap-2"><Label htmlFor="cs-solution">Solution</Label><Textarea defaultValue={study?.solution ?? ""} id="cs-solution" maxLength={2000} name="solution" /></div>
    <div className="grid gap-2"><Label htmlFor="cs-stack">Technical stack <span className="text-muted-foreground">(comma or line separated)</span></Label><Textarea defaultValue={(study?.techStack ?? []).join(", ")} id="cs-stack" name="techStack" /></div>
    <div className="grid gap-2"><Label htmlFor="cs-resp">Engineering responsibilities</Label><Textarea defaultValue={study?.responsibilities ?? ""} id="cs-resp" maxLength={2000} name="responsibilities" /></div>
    <div className="grid gap-2"><Label htmlFor="cs-arch">Architecture summary</Label><Textarea defaultValue={study?.architectureSummary ?? ""} id="cs-arch" maxLength={2000} name="architectureSummary" /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="cs-repo">Repository link (https)</Label><Input defaultValue={study?.repositoryUrl ?? ""} id="cs-repo" maxLength={2048} name="repositoryUrl" type="url" /></div>
      <div className="grid gap-2"><Label htmlFor="cs-demo">Demo link (https)</Label><Input defaultValue={study?.demoUrl ?? ""} id="cs-demo" maxLength={2048} name="demoUrl" type="url" /></div>
    </div>
    <div className="grid gap-2"><Label htmlFor="cs-results">Results <span className="text-muted-foreground">(only what you can verify)</span></Label><Textarea defaultValue={study?.results ?? ""} id="cs-results" maxLength={1500} name="results" /></div>
    <label className="flex items-start gap-2 text-sm"><input className="mt-1" defaultChecked={study?.resultsVerified ?? false} name="resultsVerified" type="checkbox" /><span>I have verified these results. Unverified results are never shown in a kit or PDF.</span></label>
    {study && images ? <CheckList legend="Screenshots" name="screenshotAssetIds" options={images} selected={selectedImageIds} /> : null}
    <FormMessage state={state} /><SubmitButton pendingLabel="Saving…">{study ? "Save case study" : "Add case study"}</SubmitButton>
  </form>;
}

export const CaseStudyStatusForm = ({ caseStudyId, status }: { caseStudyId: string; status: "archived" | "active" }) =>
  <ActionButton action={setCaseStudyStatusAction} label={status === "archived" ? "Archive case study" : "Restore case study"} pendingLabel="Saving…" values={{ caseStudyId, status }} />;

// --- Packs -----------------------------------------------------------------------------------

export function CreatePackForm({ kits, caseStudies, assets, leads }: { kits: readonly Option[]; caseStudies: readonly Option[]; assets: readonly Option[]; leads: readonly Option[] }) {
  const [state, action] = useActionState(createPackAction, idle);
  return <form action={action} className="grid gap-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="pack-kit">Kit</Label><select className={selectClassName} id="pack-kit" name="kitId" required><option value="">Select a kit</option>{kits.map((kit) => <option key={kit.id} value={kit.id}>{kit.label}</option>)}</select></div>
      <div className="grid gap-2"><Label htmlFor="pack-template">Template</Label><select className={selectClassName} id="pack-template" name="templateKey" required>{packTemplateKeys.map((key) => <option key={key} value={key}>{packTemplates[key].label}</option>)}</select></div>
    </div>
    <div className="grid gap-2"><Label htmlFor="pack-title">Pack title</Label><Input id="pack-title" maxLength={160} minLength={2} name="title" required /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="pack-recipient">Recipient name</Label><Input id="pack-recipient" maxLength={120} minLength={2} name="recipientName" required /></div>
      <div className="grid gap-2"><Label htmlFor="pack-org">Organisation</Label><Input id="pack-org" maxLength={120} name="recipientOrganisation" /></div>
    </div>
    <div className="grid gap-2"><Label htmlFor="pack-purpose">What is this for? <span className="text-muted-foreground">(for the cover note, e.g. the Senior Developer role)</span></Label><Input id="pack-purpose" maxLength={160} name="purpose" /></div>
    <div className="grid gap-2"><Label htmlFor="pack-lead">Linked CRM lead <span className="text-muted-foreground">(optional)</span></Label><select className={selectClassName} id="pack-lead" name="leadId"><option value="">None</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.label}</option>)}</select></div>
    <CheckList legend="Case studies to include" name="caseStudyIds" options={caseStudies} />
    <CheckList legend="Documents to include" name="assetIds" options={assets} />
    <p className="text-xs leading-5 text-muted-foreground">The template limits how many case studies you can choose. A cover note is drafted from your selections; you review and edit it before anyone approves the pack.</p>
    <FormMessage state={state} /><SubmitButton pendingLabel="Creating…">Create pack</SubmitButton>
  </form>;
}

type PackFormPack = Readonly<{ id: string; title: string; recipientName: string; recipientOrganisation: string | null; message: string; status: string; updatedAt: Date }>;

export function UpdatePackForm({ pack, caseStudies, assets, selectedCaseStudyIds, selectedAssetIds, kitIsBehind }: {
  pack: PackFormPack; caseStudies: readonly Option[]; assets: readonly Option[]; selectedCaseStudyIds: readonly string[]; selectedAssetIds: readonly string[]; kitIsBehind: boolean;
}) {
  const [state, action] = useActionState(updatePackAction, idle);
  return <form action={action} className="grid gap-4">
    <Hidden values={{ packId: pack.id, expectedUpdatedAt: pack.updatedAt.toISOString() }} />
    <div className="grid gap-2"><Label htmlFor="up-title">Pack title</Label><Input defaultValue={pack.title} id="up-title" maxLength={160} minLength={2} name="title" required /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="up-recipient">Recipient name</Label><Input defaultValue={pack.recipientName} id="up-recipient" maxLength={120} minLength={2} name="recipientName" required /></div>
      <div className="grid gap-2"><Label htmlFor="up-org">Organisation</Label><Input defaultValue={pack.recipientOrganisation ?? ""} id="up-org" maxLength={120} name="recipientOrganisation" /></div>
    </div>
    <div className="grid gap-2"><Label htmlFor="up-message">Cover note</Label><Textarea className="min-h-48" defaultValue={pack.message} id="up-message" maxLength={5000} name="message" /></div>
    <CheckList legend="Case studies" name="caseStudyIds" options={caseStudies} selected={selectedCaseStudyIds} />
    <CheckList legend="Documents" name="assetIds" options={assets} selected={selectedAssetIds} />
    {kitIsBehind ? <label className="flex items-start gap-2 text-sm"><input className="mt-1" name="useLatestKitVersion" type="checkbox" /><span>Use the latest saved version of the kit (this pack is pinned to an older one).</span></label> : null}
    {pack.status === "approved" ? <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">This pack is approved. Saving a change sends it back to draft, requires approval again and revokes its share links.</p> : null}
    <FormMessage state={state} /><SubmitButton pendingLabel="Saving…">Save pack</SubmitButton>
  </form>;
}

export const ApprovePackForm = ({ packId }: { packId: string }) =>
  <ActionButton action={approvePackAction} label="Approve this pack" pendingLabel="Approving…" values={{ packId }} />;

export function AttachPackForm({ packId, leads, proposals, campaigns }: { packId: string; leads: readonly Option[]; proposals: readonly Option[]; campaigns: readonly Option[] }) {
  const [state, action] = useActionState(attachPackAction, idle);
  return <form action={action} className="grid gap-3"><input name="packId" type="hidden" value={packId} />
    <Label htmlFor="attach-target">Attach as a reference to</Label>
    <select className={selectClassName} id="attach-target" name="target" required><option value="">Choose a record</option>
      <optgroup label="CRM leads">{leads.map((item) => <option key={item.id} value={`lead:${item.id}`}>{item.label}</option>)}</optgroup>
      <optgroup label="Approved proposals">{proposals.map((item) => <option key={item.id} value={`proposal:${item.id}`}>{item.label}</option>)}</optgroup>
      <optgroup label="Reviewed campaigns">{campaigns.map((item) => <option key={item.id} value={`campaign:${item.id}`}>{item.label}</option>)}</optgroup>
    </select>
    <p className="text-xs leading-5 text-muted-foreground">Attaching records a reference only. Nothing is emailed or sent, and campaign delivery does not include files.</p>
    <FormMessage state={state} /><SubmitButton pendingLabel="Attaching…">Attach pack</SubmitButton>
  </form>;
}

export const DetachPackForm = ({ packId, attachmentId }: { packId: string; attachmentId: string }) =>
  <ActionButton action={detachPackAction} label="Remove" pendingLabel="Removing…" values={{ packId, attachmentId }} />;

export function ShareLinkForm({ packId }: { packId: string }) {
  const [state, action] = useActionState(createShareLinkAction, idle);
  return <form action={action} className="grid gap-3"><input name="packId" type="hidden" value={packId} />
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="share-days">Valid for (days, 1 to 30)</Label><Input defaultValue="7" id="share-days" max={30} min={1} name="days" type="number" /></div>
      <div className="grid gap-2"><Label htmlFor="share-max">Download limit <span className="text-muted-foreground">(optional)</span></Label><Input id="share-max" max={100} min={1} name="maxDownloads" type="number" /></div>
    </div>
    <FormMessage state={state} /><SubmitButton pendingLabel="Creating…">Create share link</SubmitButton>
  </form>;
}

export const RevokeLinkForm = ({ packId, linkId }: { packId: string; linkId: string }) =>
  <ActionButton action={revokeShareLinkAction} label="Revoke" pendingLabel="Revoking…" values={{ packId, linkId }} />;

export function PurgeForm() {
  const [state, action] = useActionState(purgeArchivedAssetsAction, idle);
  return <form action={action} className="grid gap-3">
    <div className="grid gap-2"><Label htmlFor="purge-days">Archived for at least (days)</Label><Input defaultValue="30" id="purge-days" max={365} min={0} name="days" type="number" /></div>
    <div className="grid gap-2"><Label htmlFor="purge-confirm">Type PURGE to confirm</Label><Input autoComplete="off" id="purge-confirm" name="confirm" required /></div>
    <p className="text-xs leading-5 text-muted-foreground">This permanently deletes the files and every version. It cannot be undone. Documents that a pack or case study still uses are kept.</p>
    <FormMessage state={state} /><SubmitButton pendingLabel="Deleting…">Permanently delete archived documents</SubmitButton>
  </form>;
}