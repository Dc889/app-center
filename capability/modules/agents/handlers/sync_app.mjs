import {syncDifyApp} from '../adapters/syncDifyApp.mjs'

export async function execute(context) {
 const {command,state}=context


        const appInfo = await syncDifyApp(command)

        state.status = 'succeeded'

        state.result = {

          ok: true,

          failureCode: '',

          failureReason: '',

          retryable: false,

          resultId: appInfo.appId,

          version: 'v1.0.0',

          sha256: '',

          details: {

            appId: appInfo.appId,

            name: appInfo.name,

            status: '已纳管',

          },

        }

      
}
