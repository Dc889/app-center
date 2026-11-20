import {publishDifyApp} from '../adapters/publishDifyApp.mjs'

export async function execute(context) {
 const {command,state}=context


        const pubInfo = await publishDifyApp(command)

        state.status = 'succeeded'

        state.result = {

          ok: true,

          failureCode: '',

          failureReason: '',

          retryable: false,

          resultId: pubInfo.resourceId,

          version: pubInfo.versionId,

          sha256: '',

          details: {

            status: '已发布',

            scope: pubInfo.scope,

          },

        }

      
}
