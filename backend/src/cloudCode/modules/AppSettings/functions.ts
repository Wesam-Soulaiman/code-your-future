/**
 * AppSettings Cloud Functions
 *
 * Global key-value settings stored in the AppSettings collection.
 * Use for feature flags, config values, timestamps, etc.
 */
import {CloudFunction, Route} from '@90soft/parse-server-kit';
import AppSettings from '../../models/AppSettings';

@Route(AppSettings)
class AppSettingsFunctions {
  @CloudFunction({
    methods: ['POST'],
    validation: {
      requireUser: true,
      fields: {key: {required: true, type: String}},
    },
    swagger: {
      summary: 'Get a global application setting by key',
      tags: ['AppSettings'],
    },
  })
  async getAppSetting(req: Parse.Cloud.FunctionRequest) {
    const {key} = req.params as {key: string};
    const q = new Parse.Query(AppSettings);
    q.equalTo('key', key);
    const setting = await q.first({useMasterKey: true});
    return setting ? setting.value : null;
  }
}

export default AppSettingsFunctions;
