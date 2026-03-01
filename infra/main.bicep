param location string = resourceGroup().location
param environment string = 'prod'
param containerImageName string = ''
param containerImageTag string = 'latest'
param containerRegistryName string = ''

@minLength(1)
@maxLength(64)
@description('Name of the container app.')
param containerAppName string

@minLength(1)
@maxLength(64)
@description('Name of the container app environment.')
param containerAppEnvName string

@description('Relative path to the Bicep file.')
var appBicepPath = './app.bicep'

module appModule 'app.bicep' = {
  name: 'appModule'
  params: {
    location: location
    environment: environment
    containerAppName: containerAppName
    containerAppEnvName: containerAppEnvName
    containerImageName: containerImageName
    containerImageTag: containerImageTag
    containerRegistryName: containerRegistryName
  }
}

output containerAppUrl string = appModule.outputs.containerAppUrl
output containerAppName string = appModule.outputs.containerAppName
