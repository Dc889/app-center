import {execute as create_key} from './handlers/create_key.mjs'
import {execute as rotate_key} from './handlers/rotate_key.mjs'
import {execute as revoke_key} from './handlers/revoke_key.mjs'
import {clearVault} from './adapters/registration-store.mjs'
import {getKeyRegistration, listKeyRegistrations, revealKeyRegistration} from './queries/registrations.mjs'
import {key01Context, key02Context} from './queries/execution-contexts.mjs'

export const capabilityModule = Object.freeze({
  id: 'keys',
  init({openLedger}) {
    const db = openLedger('registrations')
    return () => {
      clearVault(db)
    }
  },
  actions: [
    {ticketType: 'KEY-01', ticketTypeVersion: '1', action: 'create_key', variants: [null], execute: create_key},
    {ticketType: 'KEY-02', ticketTypeVersion: '1', action: 'rotate_key', variants: [null], execute: rotate_key},
    {ticketType: 'KEY-02', ticketTypeVersion: '1', action: 'revoke_key', variants: [null], execute: revoke_key},
  ],
  resources: {},
  catalogs: {},
  routes: [
    {method: 'GET', path: '/internal/v1/key-registrations', handle: listKeyRegistrations},
    {method: 'GET', path: '/internal/v1/key-registrations/:registrationId', handle: getKeyRegistration},
    {method: 'POST', path: '/internal/v1/key-registrations/:registrationId/reveal', handle: revealKeyRegistration},
    {method: 'GET', path: '/internal/v1/execution-contexts/KEY-01', handle: key01Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/KEY-02', handle: key02Context},
  ],
})

// Legacy adapter exports; execution still goes through the registered handler.
export {createDifyApiKey} from './adapters/createDifyApiKey.mjs'
export {rotateDifyApiKey} from './adapters/rotateDifyApiKey.mjs'
export {revokeDifyApiKey} from './adapters/revokeDifyApiKey.mjs'
