import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Product } from './product.entity';
import { Category } from './category.entity';
import { CreateProductDto, CreateCategoryDto } from './dto/create-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    @InjectRepository(Category)
    private categoriesRepository: Repository<Category>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async findAll(): Promise<Product[]> {
    return this.productsRepository.find({ relations: ['category'] });
  }

  async findOne(id: number): Promise<Product> {
    const product = await this.productsRepository.findOne({ 
      where: { id },
      relations: ['category'],
    });
    if (!product) {
      throw new NotFoundException(`Product #${id} not found`);
    }
    return product;
  }

  async create(createProductDto: CreateProductDto): Promise<Product> {
    const product = this.productsRepository.create(createProductDto);
    return this.productsRepository.save(product);
  }

  async updateStock(id: number, quantity: number): Promise<Product> {
    const product = await this.findOne(id);
    product.stock = quantity;
    return this.productsRepository.save(product);
  }

  async remove(id: number): Promise<void> {
    const product = await this.findOne(id);
    await this.productsRepository.remove(product);
  }

  async searchProducts(query: string): Promise<Product[]> {
    const cacheKey = `product-search:${query}`;
    const cached = await this.cacheManager.get<Product[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const products = await this.productsRepository.find();
    const results = products.filter(p => 
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(query.toLowerCase())
    );

    await this.cacheManager.set(cacheKey, results, 60000);
    return results;
  }

  async findAllCategories(): Promise<Category[]> {
    return this.categoriesRepository.find({ relations: ['parent', 'children'] });
  }

  async findCategory(id: number): Promise<Category> {
    const category = await this.categoriesRepository.findOne({
      where: { id },
      relations: ['parent', 'children', 'products'],
    });
    if (!category) {
      throw new NotFoundException(`Category #${id} not found`);
    }
    return category;
  }

  async createCategory(dto: CreateCategoryDto): Promise<Category> {
    const category = this.categoriesRepository.create(dto);
    return this.categoriesRepository.save(category);
  }

  async getCategoryTree(categoryId: number): Promise<any> {
    const category = await this.findCategory(categoryId);
    const tree = await this.buildDescendantTree(category);

    if (category.parentId) {
      const parent = await this.categoriesRepository.findOne({ where: { id: category.parentId } });
      if (parent) {
        tree.parent = await this.buildAncestorChain(parent);
      }
    }

    return tree;
  }

  private async buildDescendantTree(category: Category): Promise<any> {
    const tree: any = {
      id: category.id,
      name: category.name,
      children: [],
    };

    const children = await this.categoriesRepository.find({ where: { parentId: category.id } });
    if (children.length > 0) {
      tree.children = await Promise.all(children.map(child => this.buildDescendantTree(child)));
    }

    return tree;
  }

  private async buildAncestorChain(category: Category): Promise<any> {
    const node: any = {
      id: category.id,
      name: category.name,
    };

    if (category.parentId) {
      const parent = await this.categoriesRepository.findOne({ where: { id: category.parentId } });
      if (parent) {
        node.parent = await this.buildAncestorChain(parent);
      }
    }

    return node;
  }

  async processProductBatch(productIds: number[]): Promise<{ success: boolean; processed: number; failed: number[] }> {
    let processed = 0;
    const failed: number[] = [];

    for (const id of productIds) {
      try {
        const product = await this.findOne(id);
        product.updatedAt = new Date();
        await this.productsRepository.save(product);
        processed++;
      } catch (error: any) {
        console.error(`Error processing product ${id}:`, error.message);
        failed.push(id);
      }
    }

    return { success: failed.length === 0, processed, failed };
  }
}