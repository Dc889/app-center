import type {ReactNode} from 'react'
import type {Role,View} from './UiContextData'

export type ResourceStampMeta = {name:string;level:string;line:string}

export type ModuleViewProps = {
  role: Role
  onNavigate: (view: View) => void
  onWorkOrder: (title: string) => void
}

export type TicketFormProps = {
  account: string
  onMeta: (meta: ResourceStampMeta) => void
}

export type WebModuleManifest = {
  readonly id: string
  readonly views?: Readonly<Partial<Record<View, (props: ModuleViewProps) => ReactNode>>>
  readonly ticketForms?: Readonly<Record<string, (props: TicketFormProps) => ReactNode>>
}

export function defineWebModule(manifest: WebModuleManifest): WebModuleManifest {
  return Object.freeze({
    id: manifest.id,
    views: manifest.views ? Object.freeze(manifest.views) : undefined,
    ticketForms: manifest.ticketForms ? Object.freeze(manifest.ticketForms) : undefined,
  })
}
