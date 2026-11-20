import {withdrawDifyApp} from '../adapters/withdrawDifyApp.mjs'

export async function execute(context) {
 const {command,state}=context


        const withdrawInfo = await withdrawDifyApp(command)

        state.status = 'succeeded'

        state.result = {

          ok: true,

          failureCode: '',

          failureReason: '',

          retryable: false,

          resultId: withdrawInfo.resourceId,

          version: '',

          sha256: '',

          details: {

            status: '已下架',

            withdrawnAt: withdrawInfo.withdrawnAt,

          },

        }

      
}
