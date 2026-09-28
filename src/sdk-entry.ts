import { registerAccessSupportRoutes } from './access-support';
import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectRoutes } from './connect';
import { registerConnectCliRoutes } from './connect-cli-routes';
import { registerConnectCliAppRoutes } from './connect-cli-apps';
import { registerConnectDeveloperAdminRoutes } from './connect-admin-developers';
import { registerConnectCliDistributionRoutes } from './connect-cli-distribution';
import { registerAccountRoutes } from './account';
import { registerLabRoutes } from './lab';
import { registerRoleAdminRoutes } from './role-admin';

registerAccessSupportRoutes(app);
registerSdkRoutes(app);
registerConnectRoutes(app);
registerConnectCliRoutes(app);
registerConnectCliAppRoutes(app);
registerConnectDeveloperAdminRoutes(app);
registerConnectCliDistributionRoutes(app);
registerAccountRoutes(app);
registerLabRoutes(app);
registerRoleAdminRoutes(app);

export default app;
