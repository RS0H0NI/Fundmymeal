param location string
param environment string
param containerAppName string
param containerAppEnvName string
param containerImageName string = 'fundmymeal'
param containerImageTag string = 'latest'
param containerRegistryName string = ''

@description('CPU cores allocated to a single container instance, e.g., 0.5, 1.0, 1.25, 1.5, 1.75, 2.0')
param containerCpuCoreCount string = '0.5'

@description('Amount of memory allocated to a single container instance, e.g., 1.0, 1.5, 2.0')
param containerMemory string = '1.0'

@description('Number of replicas of the container to deploy')
@minValue(1)
@maxValue(10)
param containerMinReplicas int = 1

@description('Maximum number of replicas of the container to deploy')
@maxValue(10)
param containerMaxReplicas int = 3

var appEnvResourceName = containerAppEnvName
var containerRegistryUrl = !empty(containerRegistryName) ? '${containerRegistryName}.azurecr.io' : ''
var imageName = !empty(containerImageName) ? containerImageName : 'fundmymeal'
var imageTag = containerImageTag

// Create Log Analytics Workspace for Container App Environment
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'law-${environment}-${uniqueString(resourceGroup().id)}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// Create Container App Environment
resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2023-05-02-preview' = {
  name: appEnvResourceName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// Create Container App
resource containerApp 'Microsoft.App/containerApps@2023-05-02-preview' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: !empty(containerRegistryName) ? [
        {
          server: containerRegistryUrl
          identity: 'System'
        }
      ] : []
    }
    template: {
      spec: [
        {
          image: !empty(containerRegistryName) 
            ? '${containerRegistryUrl}/${imageName}:${imageTag}'
            : '${imageName}:${imageTag}'
          name: 'fundmymeal-app'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'ORIGIN'
              value: 'https://${containerApp.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'RP_NAME'
              value: 'Fund My Meal'
            }
            {
              name: 'RP_ID'
              value: containerApp.properties.configuration.ingress.fqdn
            }
          ]
          resources: {
            cpu: json(containerCpuCoreCount)
            memory: '${containerMemory}Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: containerMinReplicas
        maxReplicas: containerMaxReplicas
        rules: [
          {
            name: 'cpu-scaling'
            custom: {
              query: 'cpu'
              type: 'cpu'
            }
            metadata: {
              type: 'Utilization'
              value: '70'
            }
          }
        ]
      }
    }
  }
}

output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output containerAppName string = containerApp.name
output containerAppEnvName string = containerAppEnvironment.name
