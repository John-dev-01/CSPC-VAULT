const DEFAULT_IMAGE = '/images/equipment-placeholder.png';

function equipmentImage(item) {
  const custom = typeof item?.image_url === 'string' ? item.image_url.trim() : '';
  return custom || DEFAULT_IMAGE;
}

module.exports = equipmentImage;
