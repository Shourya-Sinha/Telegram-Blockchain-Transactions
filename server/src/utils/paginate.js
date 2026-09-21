async function paginate(model, filter, query, sort = { createdAt: -1 }) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    model.countDocuments(filter),
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) || 1 };
}

module.exports = { paginate };
