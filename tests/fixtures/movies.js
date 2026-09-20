// Small, deterministic stand-in for data/movies-demo.json. Deliberately
// independent of the real demo dataset so these tests don't break every time
// someone curates the shipped demo collection.
export const movies = [
  {
    id: "m1",
    title: "The Prefect Storm",
    year: 1994,
    genres: ["Drama", "Thriller"],
    countries: ["United States"],
    format: "Blu-ray",
    watched: true,
    copies: [{ format: "Blu-ray" }],
    imdbRating: 7.5,
  },
  {
    id: "m2",
    title: "Second Sight",
    year: 1994,
    genres: ["Sci-Fi"],
    countries: ["United Kingdom"],
    format: "DVD",
    watched: false,
    copies: [{ format: "DVD" }, { format: "Blu-ray" }],
    imdbRating: 6.2,
  },
  {
    id: "m3",
    title: "Third Wheel",
    year: 1987,
    genres: ["Comedy"],
    countries: ["France"],
    format: "DVD",
    watched: false,
    copies: [{ format: "DVD" }],
    imdbRating: 5.9,
  },
  {
    id: "m4",
    title: "Fourth Wall",
    year: 2011,
    genres: ["Drama", "Comedy"],
    countries: ["United States", "France"],
    format: "Blu-ray",
    watched: true,
    copies: [{ format: "Blu-ray" }],
    imdbRating: 8.1,
  },
];
