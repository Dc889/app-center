import {installPlugin} from '../adapters/dify-install.mjs'

export async function execute(context) {
 const {command,state,row,plugin,store}=context


        state.status = 'reconciling'

        store.put(command.executionId,row)

        row.productTask = await installPlugin(command,plugin)

        // Acceptance alone does not establish that the specified version is installed.

      
}
