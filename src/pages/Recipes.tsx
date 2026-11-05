import React, { useState, useEffect } from 'react';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronLeft, 
  Search, 
  Clock, 
  Flame, 
  Heart, 
  Plus, 
  Utensils, 
  ShoppingBag, 
  Maximize2, 
  X, 
  Check, 
  Lightbulb, 
  Eye, 
  Trash2,
  Lock,
  Unlock,
  PlusCircle,
  FolderHeart,
  Calendar as CalendarIcon
} from '../components/icons';
import { cn } from '../lib/utils';
import { storage } from '../lib/storage';
import { Meal } from '../types';
import { useAuth } from '../components/AuthProvider';

// @ts-ignore
import butterChickenImg from '../assets/images/butter_chicken_1780303376531.png';
// @ts-ignore
import stirFryImg from '../assets/images/rainbow_chicken_stir_fry_dish_1780303652031.png';
// @ts-ignore
import pestoImg from '../assets/images/pesto_pasta_dish_1780305046247.png';

interface RecipeType extends Omit<Meal, 'date' | 'type' | 'uid'> {
  uid?: string;
  id: string;
  name: string;
  calories?: number;
  protein?: number;
  prepTime?: string;
  cookTime?: string;
  ingredients: string[];
  instructions: string;
  photo?: string;
  category: 'curated' | 'custom';
}

const CURATED_RECIPES: RecipeType[] = [
  {
    id: 'curated-1',
    name: 'Butter chicken',
    prepTime: '20 min',
    cookTime: '25 min',
    calories: 640,
    protein: 38,
    photo: butterChickenImg,
    category: 'curated',
    ingredients: [
      '1/2 cup plain yoghurt, full fat',
      '1 tbsp lemon juice',
      '1 tsp tumeric powder',
      '2 tsp garam masala (Note 1)',
      '1/2 tsp chilli powder or cayenne pepper powder (Note 2)',
      '1 tsp ground cumin',
      '1 tbsp ginger, freshly grated',
      '2 cloves garlic, crushed',
      '1.5 lb / 750 g chicken thigh fillets, cut into bite size pieces',
      '2 tbsp (30 g) ghee or butter, OR 1 tbsp vegetable oil (Note 3)',
      '1 cup tomato passata (aka tomato puree) (Note 4)',
      '1 cup heavy / thickened cream (Note 5)',
      '1 tbsp sugar',
      '1 1/4 tsp salt',
      'Basmati rice',
      'Coriander/cilantro (optional)'
    ],
    instructions: `Optional blitz: for an extra smooth sauce, combine the Marinade ingredients (except the chicken) in a food processor and blend until smooth. (I do not do this)

Marinade: Combine the Marinade ingredients with the chicken in a bowl. Cover and refrigerate overnight, or up to 24 hours (minimum 3 hrs).

Cook chicken: Heat the ghee (butter or oil) over high heat in a large fry pan. Take the chicken out of the Marinade but do not wipe or shake off the marinade from the chicken (but don’t pour the Marinade left in the bowl into the fry pan). 
Place chicken in the fry pan and cook for around 3 minutes, or until the chicken is white all over (it doesn’t really brown because of the Marinade).

Sauce: Add the tomato passata, cream, sugar and salt. Also add any remaining marinade left in the bowl. Turn down to low and simmer for 20 minutes. Do a taste test to see if it needs more salt.

Garnish with coriander/cilantro leaves if using. Serve with basmati rice.`
  },
  {
    id: 'curated-2',
    name: 'Rainbow Chicken Stir Fry',
    prepTime: '20 min',
    cookTime: '10 min',
    calories: 394,
    protein: 20,
    photo: stirFryImg,
    category: 'curated',
    ingredients: [
      '4 tsp cornflour / cornstarch',
      '1 cup water',
      '1 tbsp oyster sauce (can sub with vegetarian oyster sauce)',
      '3 tbsp Chinese cooking wine (2 tbsp for sauce, 1 tbsp for chicken marinade) (Note 1)',
      '2 tbsp light soy sauce or all-purpose soy sauce (Note 2)',
      'Pinch white pepper (or black pepper)',
      '350g / 12 oz boneless chicken thighs, cut in half then into 1 cm / 0.4" strips (Note 3)',
      '2 tbsp peanut oil, vegetable, or canola oil',
      '4 garlic cloves, finely minced',
      '3 green onion stems, cut into 4 cm / 2" lengths (whites separated)',
      '1 cup sugar snap peas or small snow peas, strings removed (Note 5)',
      '1/2 each red and yellow capsicum (bell pepper), deseeded, cut in 1 cm / 0.4" strips',
      '3 baby bok choy, leaves cut off stems, big stems cut lengthways',
      '3/4 cup unsalted roasted cashews (or almonds)',
      '3/4 cup frozen shelled edamame beans',
      '1 1/2 cups purple cabbage, cut into 5 x 1 cm / 0.4" strips',
      '2 tbsp sesame oil (for finishing)',
      'White rice (for serving)'
    ],
    instructions: `Cook Mode: Prevent screen from sleeping

[ABBREVIATED METHOD]:
Cook chicken until mostly cooked, add garlic and white part of green onion towards end. Add first: capsicum, bok choy stems, cashews and edamame (1 min). Then bok choy leaves, cabbage and green part of green onion (30 seconds). Add sauce, thicken, then finish with sesame oil. Serve!

[FULL INSTRUCTIONS]:
1. Sauce – In a jug, mix cornflour with a splash of the water until dissolved. Mix in everything else except the remaining water until dissolved. Then add remaining water.
2. Chicken – Toss chicken with Chinese cooking wine and pepper.
3. Cook – Heat the oil in a large 30 cm / 12" non stick skillet over high heat (Note 6 on cooking vessel). Add chicken then stir constantly until mostly cooked, about 2 minutes.
4. Add garlic and the white part of green onion, cook for 1 minute.
5. Add the capsicum, sugar snap peas, bok choy stem, cashews and frozen edamame. Cook 1 minute.
6. Add bok choy leaves, cabbage and green part of green onions. Toss with two spatulas until slightly wilted (~30 seconds).
7. Sauce – Add the sauce, stir and let it simmer until it becomes glossy and thickens so it coats everything beautifully, about 1 minute.
8. Sesame oil – Add sesame oil, toss through, then serve over rice.`
  },
  {
    id: 'curated-3',
    name: 'Pesto Pasta',
    prepTime: '10 min',
    cookTime: '15 min',
    calories: 380,
    protein: 12,
    photo: pestoImg,
    category: 'curated',
    ingredients: [
      '1 quantity homemade pesto (Note 1)',
      '300 – 350 g / 10 – 12 oz pasta of choice (ziti, penne and spaghetti are favourites, Note 2)',
      '2 tsp salt',
      '3/4 cup pasta cooking water',
      'Parmesan, for serving'
    ],
    instructions: `Cook Mode: Prevent screen from sleeping

Bring a large pot of water to the boil with the salt.
Add pasta and cook for the length of time per the packet.
Just before draining, scoop out 1 cup of of the pasta cooking water.
Drain pasta in a colander, leave it for a minute.
Transfer pasta to a bowl (do NOT use the cooking pot as it is too hot and will turn the basil black).
Add pesto and 1/4 cup of pasta water. Toss to coat pasta in pesto, adding more water if required to make pasta silky and saucy, rather than dry and sticky.
Taste, add more salt and pepper if desired.
Serve immediately, garnished with fresh parmesan.`
  }
];

const Recipes: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recipes, setRecipes] = useState<RecipeType[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'curated' | 'custom'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeType | null>(null);
  
  // Checking off ingredient item state for interactive cook lists
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>({});
  
  // Custom Recipe Creator Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrep, setNewPrep] = useState('');
  const [newCook, setNewCook] = useState('');
  const [newCals, setNewCals] = useState('');
  const [newProt, setNewProt] = useState('');
  const [newIngs, setNewIngs] = useState<string[]>(['']);
  const [newInst, setNewInst] = useState('');
  
  // Cook mode Stay-awake
  const [screenWakeLocked, setScreenWakeLocked] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);

  useEffect(() => {
    // Fetch custom recipes from store
    const loadRecipes = async () => {
      try {
        const stored = await storage.getAll<Meal>(storage.key.RECIPES);
        const mappedStored: RecipeType[] = stored.map(item => ({
          id: item.id,
          name: item.name,
          calories: item.calories,
          protein: item.protein,
          prepTime: item.prepTime,
          cookTime: item.cookTime,
          ingredients: item.ingredients || [],
          instructions: item.instructions || item.recipe || '',
          photo: item.photo,
          category: 'custom'
        }));
        setRecipes([...CURATED_RECIPES, ...mappedStored]);
      } catch (err) {
        console.error('Error loading custom recipes:', err);
        setRecipes(CURATED_RECIPES);
      }
    };
    loadRecipes();
  }, []);

  const handleCreateRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const newCustomMeal: Meal = {
        id: Math.random().toString(36).substring(2, 9),
        uid: user?.uid || 'guest',
        date: new Date().toISOString(),
        type: 'lunch', // Default type
        name: newName,
        calories: parseInt(newCals) || 0,
        protein: parseInt(newProt) || 0,
        prepTime: newPrep || '10 min',
        cookTime: newCook || '10 min',
        ingredients: newIngs.filter(i => i.trim() !== ''),
        instructions: newInst
      };

      await storage.add(storage.key.RECIPES, newCustomMeal);
      
      const newRecipeItem: RecipeType = {
        id: newCustomMeal.id,
        name: newCustomMeal.name,
        calories: newCustomMeal.calories,
        protein: newCustomMeal.protein,
        prepTime: newCustomMeal.prepTime,
        cookTime: newCustomMeal.cookTime,
        ingredients: newCustomMeal.ingredients || [],
        instructions: newCustomMeal.instructions || '',
        category: 'custom'
      };

      setRecipes(prev => [...prev, newRecipeItem]);
      setShowCreateModal(false);
      
      // Clear fields
      setNewName('');
      setNewPrep('');
      setNewCook('');
      setNewCals('');
      setNewProt('');
      setNewIngs(['']);
      setNewInst('');
    } catch (err) {
      console.error('Error creating custom recipe:', err);
    }
  };

  const handleDeleteCustomRecipe = async (recipeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this custom recipe?')) return;
    try {
      await storage.delete(storage.key.RECIPES, recipeId);
      setRecipes(prev => prev.filter(r => r.id !== recipeId));
      if (selectedRecipe?.id === recipeId) {
        setSelectedRecipe(null);
      }
    } catch (err) {
      console.error('Error deleting recipe:', err);
    }
  };

  const toggleWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        if (!screenWakeLocked) {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
          setScreenWakeLocked(true);
        } else {
          if (wakeLock) {
            await wakeLock.release();
            setWakeLock(null);
          }
          setScreenWakeLocked(false);
        }
      } catch (err) {
        console.error('Wake lock request failed:', err);
        setScreenWakeLocked(!screenWakeLocked);
      }
    } else {
      setScreenWakeLocked(!screenWakeLocked);
    }
  };

  const handleScheduleMeal = (recipe: RecipeType) => {
    const mealData = {
      name: recipe.name,
      calories: recipe.calories || 0,
      protein: recipe.protein || 0,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      photo: recipe.photo,
      uid: user?.uid || 'guest',
      saveToRecipes: false
    };

    sessionStorage.setItem('pendingMeal', JSON.stringify(mealData));
    navigate('/assign-meal');
  };

  // Filter recipes based on query & tab
  const filteredRecipes = recipes.filter(r => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = r.name.toLowerCase().includes(query) || 
      r.ingredients.some(i => i.toLowerCase().includes(query)) ||
      r.instructions.toLowerCase().includes(query);
      
    if (activeTab === 'all') return matchesSearch;
    return matchesSearch && r.category === activeTab;
  });

  return (
    <div className="space-y-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <button 
          onClick={() => navigate('/plan')}
          className="p-2 text-primary hover:bg-primary/10 rounded-full transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-primary tracking-tight font-sans">
          Serene Recipe Book
        </h1>
        <button 
          onClick={() => setShowCreateModal(true)}
          className="p-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-all"
          title="Create Custom Recipe"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Categories Tabs & Search */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search recipes, ingredients, keyword..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-2xl bg-card border border-border focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all text-sm font-medium"
          />
        </div>

        <div className="flex gap-2 p-1 bg-muted/60 rounded-xl overflow-x-auto">
          {[
            { id: 'all', label: 'All Recipes' },
            { id: 'curated', label: 'Curated' },
            { id: 'custom', label: 'My Custom' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex-1 py-2 text-center text-xs font-bold uppercase tracking-wider rounded-lg border border-transparent transition-all whitespace-nowrap px-3",
                activeTab === tab.id 
                  ? "bg-card  text-foreground shadow-sm font-black border-border/40"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid List */}
      {filteredRecipes.length === 0 ? (
        <div className="text-center py-16 space-y-3 bg-muted/30 rounded-3xl p-6 border border-dashed border-border">
          <FolderHeart className="w-8 h-8 mx-auto text-muted-foreground" />
          <h3 className="text-sm font-bold">No recipes found</h3>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Try adjusting your search criteria or write a new custom recipe template of your choice.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filteredRecipes.map((r, index) => (
            <motion.div
              layoutId={`recipe-card-${r.id}`}
              onClick={() => {
                setSelectedRecipe(r);
                setCheckedIngredients({});
              }}
              key={r.id}
              className="bg-card hover:bg-card/90 rounded-sm border border-border overflow-hidden cursor-pointer shadow-sm transition-all hover:shadow-md flex flex-col h-full"
            >
              <div className="relative aspect-square w-full bg-muted overflow-hidden">
                <img 
                  src={r.photo || `https://picsum.photos/seed/${r.name}/400/400`} 
                  alt={r.name} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <span className={cn(
                  "absolute top-3 right-3 text-[8px] font-black uppercase tracking-wider px-2 py-1 rounded-md shadow-sm border",
                  r.category === 'curated' 
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                    : "bg-primary text-primary border-primary"
                )}>
                  {r.category === 'curated' ? 'Curated' : 'Custom'}
                </span>
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div className="space-y-1">
                  <h3 className="text-xs font-extrabold text-foreground tracking-tight line-clamp-2 leading-tight uppercase">
                    {r.name}
                  </h3>
                  <div className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground uppercase font-mono">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>{r.prepTime || '10m'} prep</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-[#b45309]">
                    <Flame className="w-3.5 h-3.5 shrink-0" />
                    <span>{r.calories || 0} kcal</span>
                  </div>
                  {r.category === 'custom' && (
                    <button 
                      onClick={(e) => handleDeleteCustomRecipe(r.id, e)}
                      className="p-1.5 text-muted-foreground hover:text-red transition-colors rounded-full hover:bg-red/10 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Infinite Chef Detail View Overlay Overlay */}
      <AnimatePresence>
        {selectedRecipe && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 overflow-y-auto"
          >
            <div className="min-h-screen flex items-center justify-center p-4">
              <motion.div 
                layoutId={`recipe-card-${selectedRecipe.id}`}
                className="w-full max-w-2xl bg-card rounded-sm overflow-hidden border border-border shadow-2xl relative"
              >
                {/* Hero Photo Header */}
                <div className="relative aspect-video w-full bg-muted">
                  <img 
                    src={selectedRecipe.photo || `https://picsum.photos/seed/${selectedRecipe.name}/800/450`} 
                    alt={selectedRecipe.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/55 flex flex-col justify-end p-6 md:p-8">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-primary-foreground/80 mb-2">
                      {selectedRecipe.category === 'curated' ? 'Official Curated Coordinates' : 'My Custom Menu'}
                    </span>
                    <h2 className="text-2xl md:text-3xl font-black text-primary-foreground tracking-tight uppercase">
                      {selectedRecipe.name}
                    </h2>
                  </div>

                  <button 
                    onClick={() => setSelectedRecipe(null)}
                    className="absolute top-4 right-4 p-2 bg-black/50 text-primary-foreground hover:bg-black/70 rounded-full transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Stats Bar */}
                <div className="grid grid-cols-4 border-b border-border/50 text-center select-none bg-muted/20">
                  <div className="p-4 flex flex-col items-center justify-center gap-1 border-r border-border/40">
                    <Flame className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-extrabold">{selectedRecipe.calories || 0}</span>
                    <span className="text-[7.5px] font-black uppercase tracking-widest text-muted-foreground leading-none">Calories</span>
                  </div>
                  <div className="p-4 flex flex-col items-center justify-center gap-1 border-r border-border/40">
                    <Heart className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-extrabold">{selectedRecipe.protein || 0}g</span>
                    <span className="text-[7.5px] font-black uppercase tracking-widest text-muted-foreground leading-none">Protein</span>
                  </div>
                  <div className="p-4 flex flex-col items-center justify-center gap-1 border-r border-border/40">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold leading-tight">{selectedRecipe.prepTime || '10m'}</span>
                    <span className="text-[7.5px] font-black uppercase tracking-widest text-muted-foreground leading-none">Prep Time</span>
                  </div>
                  <div className="p-4 flex flex-col items-center justify-center gap-1">
                    <Utensils className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-bold leading-tight">{selectedRecipe.cookTime || '10m'}</span>
                    <span className="text-[7.5px] font-black uppercase tracking-widest text-muted-foreground leading-none">Cook Time</span>
                  </div>
                </div>

                {/* Cook mode stay-awake controller */}
                <div className="px-6 py-4 md:px-8 border-b border-border/30 bg-[#fef3c7]/20 #78350f]/10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Lightbulb className="w-4.5 h-4.5 text-amber-500 fill-current animate-pulse shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 leading-none">Cook Mode</span>
                      <span className="text-[11px] font-medium text-muted-foreground leading-snug">Prevent screen from sleeping while cooking</span>
                    </div>
                  </div>
                  <button
                    onClick={toggleWakeLock}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all cursor-pointer shadow-sm ",
                      screenWakeLocked 
                        ? "bg-amber-500 border-amber-400 text-primary-foreground"
                        : "bg-card  border-amber-200 text-amber-700"
                    )}
                  >
                    {screenWakeLocked ? (
                      <>
                        <Lock className="w-3 h-3 fill-current" /> Screen Active
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3 h-3" /> Turn On
                      </>
                    )}
                  </button>
                </div>

                <div className="p-6 md:p-8 space-y-6 md:max-h-[50vh] overflow-y-auto">
                  {/* Interactive Ingredients Checklist */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-widest text-foreground flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4 text-primary" />
                        Interactive Checklist
                      </h4>
                      <span className="text-[9px] font-bold text-muted-foreground font-mono">
                        {Object.values(checkedIngredients).filter(Boolean).length}/{selectedRecipe.ingredients.length} Done
                      </span>
                    </div>

                    <div className="grid gap-2 border border-border/50 p-4 rounded-2xl bg-muted/10">
                      {selectedRecipe.ingredients.map((ing, i) => (
                        <label 
                          key={i} 
                          className={cn(
                            "flex items-start gap-3 p-2.5 rounded-xl border border-transparent hover:bg-muted/30 cursor-pointer select-none transition-all",
                            checkedIngredients[ing] && "opacity-50 line-through bg-muted/10 border-border/20"
                          )}
                        >
                          <input 
                            type="checkbox" 
                            checked={!!checkedIngredients[ing]}
                            onChange={(e) => setCheckedIngredients(prev => ({ ...prev, [ing]: e.target.checked }))}
                            className="w-4.5 h-4.5 rounded border-card text-primary focus:ring-primary/60 cursor-pointer mt-0.5"
                          />
                          <span className="text-xs font-semibold leading-relaxed text-[#4A3728] ">
                            {ing}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Fully formatted step directions */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-widest text-foreground flex items-center gap-2">
                      <Utensils className="w-4 h-4 text-primary" />
                      Detailed Instructions
                    </h4>
                    <div className="bg-card border border-border p-5 rounded-2xl md:p-6 shadow-xs">
                      <p className="text-xs font-medium leading-relaxed font-sans whitespace-pre-line text-muted-foreground">
                        {selectedRecipe.instructions}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="border-t border-border/50 p-6 flex flex-col md:flex-row gap-3 bg-muted/10">
                  <button
                    onClick={() => handleScheduleMeal(selectedRecipe)}
                    className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
                  >
                    <CalendarIcon className="w-4 h-4 shrink-0" /> Plan & Schedule on Coordinates
                  </button>
                  <button
                    onClick={() => setSelectedRecipe(null)}
                    className="py-4 px-6 border border-border rounded-var text-muted-foreground hover:text-foreground text-[10px] font-black uppercase tracking-widest hover:bg-muted transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Custom Recipe Slide/Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto">
            <div className="min-h-screen flex items-center justify-center p-4">
              <motion.form 
                onSubmit={handleCreateRecipe}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-lg bg-card rounded-sm border border-border p-6 md:p-8 space-y-6 shadow-2xl relative"
              >
                <div className="flex items-center justify-between border-b border-border/50 pb-4">
                  <div className="flex items-center gap-2">
                    <PlusCircle className="w-5 h-5 text-primary" />
                    <h3 className="text-base font-extrabold text-foreground uppercase tracking-wider">
                      Write Custom Recipe
                    </h3>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="p-1.5 text-muted-foreground hover:bg-muted rounded-full transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                  {/* Name field */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#4A3728] ">Meal Name</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        required
                        placeholder="e.g., Rosemary Roasted Chicken"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full p-3.5 pr-11 rounded-xl border border-border bg-card outline-none focus:ring-1 focus:ring-primary font-semibold text-xs transition-all"
                      />
                      <VoiceButton
                        size="sm"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2"
                        onTranscript={(text) => setNewName(prev => appendDictation(prev, text))}
                        label="Dictate meal name"
                      />
                    </div>
                  </div>

                  {/* Cook & Prep */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#4A3728] ">Prep Time</label>
                      <input 
                        type="text" 
                        placeholder="e.g., 15 min"
                        value={newPrep}
                        onChange={(e) => setNewPrep(e.target.value)}
                        className="w-full p-3.5 rounded-xl border border-border bg-card outline-none focus:ring-1 focus:ring-primary font-mono text-xs transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#4A3728] ">Cook Time</label>
                      <input 
                        type="text" 
                        placeholder="e.g., 30 min"
                        value={newCook}
                        onChange={(e) => setNewCook(e.target.value)}
                        className="w-full p-3.5 rounded-xl border border-border bg-card outline-none focus:ring-1 focus:ring-primary font-mono text-xs transition-all"
                      />
                    </div>
                  </div>

                  {/* Calories & Protein */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#4A3728] ">Calories (kcal)</label>
                      <input 
                        type="number" 
                        placeholder="e.g., 450"
                        value={newCals}
                        onChange={(e) => setNewCals(e.target.value)}
                        className="w-full p-3.5 rounded-xl border border-border bg-card outline-none focus:ring-1 focus:ring-primary font-mono text-xs transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#4A3728] ">Protein (g)</label>
                      <input 
                        type="number" 
                        placeholder="e.g., 32"
                        value={newProt}
                        onChange={(e) => setNewProt(e.target.value)}
                        className="w-full p-3.5 rounded-xl border border-border bg-card outline-none focus:ring-1 focus:ring-primary font-mono text-xs transition-all"
                      />
                    </div>
                  </div>

                  {/* Ingredients Inputs */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#4A3728] ">Ingredients Checklist</label>
                      <button 
                        type="button" 
                        onClick={() => setNewIngs([...newIngs, ''])}
                        className="text-[9px] font-bold text-primary uppercase tracking-widest flex items-center gap-1 hover:bg-primary/5 px-2 py-1 rounded"
                      >
                        <Plus className="w-3 h-3" /> Add Item
                      </button>
                    </div>

                    {newIngs.map((ing, i) => (
                      <div key={i} className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder={`Item #${i + 1}`}
                          value={ing}
                          onChange={(e) => {
                            const clone = [...newIngs];
                            clone[i] = e.target.value;
                            setNewIngs(clone);
                          }}
                          className="flex-1 p-3 rounded-xl border border-border bg-card outline-none focus:ring-1 focus:ring-primary text-xs font-semibold"
                        />
                        {newIngs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setNewIngs(newIngs.filter((_, idx) => idx !== i))}
                            className="p-3 text-muted-foreground hover:text-red rounded-xl hover:bg-red/5"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Step Directions */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#4A3728] ">Preparation Instructions</label>
                    <div className="relative">
                      <textarea 
                        required
                        rows={5}
                        placeholder="List steps on how to prepare..."
                        value={newInst}
                        onChange={(e) => setNewInst(e.target.value)}
                        className="w-full p-4 pb-12 rounded-xl border border-border bg-card outline-none focus:ring-1 focus:ring-primary text-xs font-medium leading-relaxed font-sans"
                      />
                      <VoiceButton
                        size="sm"
                        className="absolute bottom-2 right-2"
                        onTranscript={(text) => setNewInst(prev => appendDictation(prev, text))}
                        label="Dictate instructions"
                      />
                    </div>
                  </div>
                </div>

                {/* Confirm actions */}
                <div className="flex gap-3 border-t border-border/50 pt-4">
                  <button
                    type="submit"
                    className="flex-1 py-4 bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-[0.15em] rounded-xl cursor-pointer"
                  >
                    Save Custom Recipe
                  </button>
                  <button 
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="py-4 px-6 border border-border text-muted-foreground hover:bg-muted font-bold text-[10px] uppercase tracking-widest rounded-xl transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </motion.form>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Recipes;
