import {check} from '../../../runtime/http.mjs'
import {execute as download} from './handlers/download.mjs'
import {cancel as cancelDownload} from './handlers/cancel_download.mjs'
import {execute as publish_skill} from './handlers/publish_skill.mjs'
import {execute as revise_skill} from './handlers/revise_skill.mjs'
import {execute as withdraw_skill} from './handlers/withdraw_skill.mjs'
import {catalogDetail, catalogVersions, listCatalog} from './queries/catalog.mjs'
import {getSkillIntake, uploadSkillIntake} from './queries/intake.mjs'
import {skl02Context, skl04Context} from './queries/execution-contexts.mjs'
import {resources as skill} from './queries/resources-skill.mjs'

function validateDownloadPayload(payload) {
  const keys = ['version', 'sha256']
  check(
    Object.keys(payload).length === keys.length &&
      keys.every(k => typeof payload[k] === 'string' && payload[k]) &&
      /^[a-f0-9]{64}$/.test(payload.sha256),
    400,
    'INVALID_REQUEST',
  )
}

export const capabilityModule = Object.freeze({
  id: 'skills',
  actions: [
    {ticketType: 'SKL-01', ticketTypeVersion: '1', action: 'publish_skill', variants: [null], execute: publish_skill},
    {ticketType: 'SKL-02', ticketTypeVersion: '1', action: 'revise_skill', variants: [null], execute: revise_skill},
    {
      ticketType: 'SKL-03',
      ticketTypeVersion: '1',
      action: 'download',
      variants: [null],
      execute: download,
      cancel: cancelDownload,
      validatePayload: validateDownloadPayload,
      retryOnServerError: true,
    },
    {ticketType: 'SKL-04', ticketTypeVersion: '1', action: 'withdraw_skill', variants: [null], execute: withdraw_skill},
  ],
  resources: {skill},
  catalogs: {skill: {list: listCatalog, detail: catalogDetail, versions: catalogVersions}},
  routes: [
    {method: 'POST', path: '/internal/v1/intake/skill', handle: uploadSkillIntake},
    {method: 'GET', path: '/internal/v1/intake/skill/:intakeId', handle: getSkillIntake},
    {method: 'GET', path: '/internal/v1/execution-contexts/SKL-02', handle: skl02Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/SKL-04', handle: skl04Context},
  ],
})
