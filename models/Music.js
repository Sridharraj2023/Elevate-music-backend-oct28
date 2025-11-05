import mongoose from 'mongoose';

const musicSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    artist: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    categoryType: {
      type: mongoose.Schema.Types.ObjectId, // Reference to a specific type's _id within the category
      required: false, // Optional, as not all categories might have types
    },
    fileUrl: {
      type: String,
      required: true,
    },
    thumbnailUrl: {
      type: String,
      default: '',
    },
    duration: {
      type: Number,
      required: true,
      min: 1,
    },
    releaseDate: {
      type: Date,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
  },
);

const Music = mongoose.model('Music', musicSchema);

export default Music;
