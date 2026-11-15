import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('inventory_categories')
export class InventoryCategory {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column({ unique: true }) code: string;
    @Column({ unique: true }) name: string;
}

@Entity('inventory_items')
export class InventoryItem {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column() name: string;
    @Column({ nullable: true }) category: string;
    @Column({ nullable: true }) description: string;
    @Column({ default: 0 }) quantity: number;
    @Column({ default: 'pcs' }) unit: string;
    @Column({ default: 'Available' }) status: string;
    @Column({ nullable: true }) location: string;
    @Column({ name: 'photo_url', nullable: true }) photoUrl: string;
    @Column({ name: 'min_quantity', default: 0 }) minQuantity: number;
    @Column({ nullable: true }) code: string;
    @Column({ name: 'sub_location', nullable: true }) subLocation: string;
    @Column({ name: 'extra_info', nullable: true }) extraInfo: string;
    @Column({ nullable: true, default: 'Unknown' }) condition: string;
    @Column({ name: 'assigned_to', nullable: true }) assignedTo: string;
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'assigned_to' }) assignee: User;
    @Column({ name: 'created_by', nullable: true }) createdBy: string;
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'created_by' }) creator: User;
    @Column({ name: 'source_wishlist_item_id', type: 'varchar', nullable: true }) sourceWishlistItemId: string | null;
    @Column({ name: 'source_wishlist_note', type: 'varchar', nullable: true }) sourceWishlistNote: string | null;
    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
    @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

@Entity('inventory_logs')
export class InventoryLog {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column({ name: 'item_id' }) itemId: string;
    @ManyToOne(() => InventoryItem, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'item_id' }) item: InventoryItem;
    @Column({ name: 'user_id', nullable: true }) userId: string;
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'user_id' }) user: User;
    @Column() action: string;
    @Column({ name: 'quantity_delta', nullable: true }) quantityDelta: number;
    @Column({ nullable: true }) notes: string;
    @CreateDateColumn({ name: 'logged_at' }) loggedAt: Date;
}
