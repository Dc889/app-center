export * from './web/KeyCreation'
export * from './web/KeyLifecycle'
export * from './web/KeyRegistrationPicker'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {KeyCreation} from './web/KeyCreation'
import {KeyLifecycle} from './web/KeyLifecycle'

export const moduleWeb = defineWebModule({
  id: 'keys',
  ticketForms: {
    'KEY-01': () => createElement(KeyCreation),
    'KEY-02': () => createElement(KeyLifecycle),
  },
})
