export * from './web/SkillCancellationDesk'
export * from './web/SkillDownloadApplication'
export * from './web/SkillMonitor'
export * from './web/SkillPublication'
export * from './web/SkillVersions'
export * from './web/SkillWarehouse'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {SkillDownloadApplication} from './web/SkillDownloadApplication'
import {SkillMonitor} from './web/SkillMonitor'
import {SkillPublication} from './web/SkillPublication'
import {SkillWarehouse} from './web/SkillWarehouse'

export const moduleWeb = defineWebModule({
  id: 'skills',
  views: {
    skills: ({role}) => createElement(SkillMonitor, {key: role, role}),
    skillWarehouse: ({role, onWorkOrder}) => createElement(SkillWarehouse, {key: role, role, onWorkOrder}),
  },
  ticketForms: {
    'SKL-01': () => createElement(SkillPublication),
    'SKL-03': ({account, onMeta}) => createElement(SkillDownloadApplication, {account, onMeta}),
  },
})
