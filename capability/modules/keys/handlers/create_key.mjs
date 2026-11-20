import {getDifyConfig} from '../../../platform/dify/public.mjs'
import {createDifyApiKey} from '../adapters/createDifyApiKey.mjs'
import {registerKey} from '../adapters/registration-store.mjs'
import {readApprovedInput} from './approved-input.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const approved = await readApprovedInput(clients, command)
  const fields = approved?.fields ?? {}
  const appId = fields['Dify应用ID'] || command.resourceId
  const workspaceId = fields['Dify workspace ID'] || command.payload?.workspaceId || getDifyConfig().workspaceId

  const keyInfo = await createDifyApiKey({...command, resourceId: appId})

  let registrationId = keyInfo.keyId
  let revealExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  if (openLedger) {
    const db = openLedger('registrations')
    const saved = registerKey(
      db,
      {
        appId,
        workspaceId,
        keyId: keyInfo.keyId,
        lastFour: keyInfo.lastFour,
        ownerAccount: command.account,
        ownerOrg: command.org,
        apiBase: keyInfo.apiBase,
        callerName: fields['调用方名称'],
        callerOrg: fields['调用方组织'],
        environment: fields['调用环境'],
        publicationTicketNo: fields['关联发布工单号'] ?? null,
      },
      keyInfo.secret,
    )
    registrationId = saved.record.registrationId
    revealExpiresAt = saved.revealExpiresAt
  }

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: registrationId,
    version: '1',
    sha256: '',
    details: {
      'Dify密钥ID': keyInfo.keyId,
      '密钥后四位': keyInfo.lastFour,
      'Dify API地址': keyInfo.apiBase,
      '密钥登记ID': registrationId,
      registrationId,
      revealExpiresAt,
    },
  }
}
