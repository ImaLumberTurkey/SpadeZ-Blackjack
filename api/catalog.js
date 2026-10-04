import catalogItemsHandler from './catalog/items.js'

export default async function handler(request, response) {
  return catalogItemsHandler(request, response)
}