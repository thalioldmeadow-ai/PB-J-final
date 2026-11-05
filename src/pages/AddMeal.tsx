import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Plus, Search, Edit3, CheckCircle2, ArrowRight, Camera, X } from '../components/icons';
import { cn, compressImage } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { Meal } from '../types';
// @ts-ignore
import butterChickenImg from '../assets/images/butter_chicken_1780303376531.png';
// @ts-ignore
import stirFryImg from '../assets/images/rainbow_chicken_stir_fry_dish_1780303652031.png';
// @ts-ignore
import pestoImg from '../assets/images/pesto_pasta_dish_1780305046247.png';

const AddMeal: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  
  const [mode, setMode] = useState<'selection' | 'manual'>('selection');
  const [mealType, setMealType] = useState<string>(searchParams.get('type') || 'breakfast');
  const [date, setDate] = useState<string>(searchParams.get('date') || new Date().toISOString());
  
  // Search and Link state
  const [searchQuery, setSearchQuery] = useState('');
  const [recipeLink, setRecipeLink] = useState('');
  const [isLinkAnalyzed, setIsLinkAnalyzed] = useState(false);

  // Manual Entry State
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [ingredients, setIngredients] = useState<string[]>(['']);
  const [instructions, setInstructions] = useState('');
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  
  // Recent Meals State
  const [recentMeals, setRecentMeals] = useState<Meal[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    fetchRecentMeals();
  }, []);

  const fetchRecentMeals = async () => {
    setLoadingRecent(true);
    try {
      const allMeals = await storage.getAll<Meal>(storage.key.MEALS);
      setRecentMeals(allMeals.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5));
    } catch (error) {
      console.error('Error fetching recent meals:', error);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleAddIngredient = () => setIngredients([...ingredients, '']);
  const handleIngredientChange = (index: number, value: string) => {
    const newIngredients = [...ingredients];
    newIngredients[index] = value;
    setIngredients(newIngredients);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const compressed = await compressImage(reader.result as string);
          setPhoto(compressed);
        } catch (error) {
          console.error('Error compressing image:', error);
          setPhoto(reader.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (saveToRecipes: boolean) => {
    const mealData = {
      name,
      calories: parseInt(calories) || 0,
      protein: parseInt(protein) || 0,
      ingredients: ingredients.filter(i => i.trim() !== ''),
      instructions,
      prepTime,
      cookTime,
      photo: photo || undefined,
      uid: user?.uid || 'guest',
      date,
      type: mealType,
      saveToRecipes
    };

    
    try {
      // Store in session storage to pass to the assignment page
      sessionStorage.setItem('pendingMeal', JSON.stringify(mealData));
      setShowSaveModal(false);
      navigate('/assign-meal');
    } catch (error) {
      console.error('Error saving to session storage:', error);
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        alert('Data is too large (likely the photo). Please try without the photo or use a smaller one.');
      } else {
        alert('An error occurred. Please try again.');
      }
    }
  };

  const handleAddLink = () => {
    if (!recipeLink.trim()) return;
    // Mock analysis
    setIsLinkAnalyzed(true);
    setTimeout(() => {
      // In a real app, this would trigger AI analysis
      setName("Analyzed Recipe from Link");
      setMode('manual');
    }, 1500);
  };

  const handleQuickAdd = (meal: Meal) => {
    const mealData = {
      ...meal,
      uid: user?.uid || 'guest',
      date,
      type: mealType,
      saveToRecipes: false
    };

    sessionStorage.setItem('pendingMeal', JSON.stringify(mealData));
    navigate('/assign-meal');
  };

  const handleSavedRecipeClick = (mealId: string) => {
    if (mealId === '1') {
      setName('Butter chicken');
      setCalories('640');
      setProtein('38');
      setPrepTime('20 min');
      setCookTime('25 min');
      setIngredients([
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
      ]);
      setInstructions(
        `Optional blitz: for an extra smooth sauce, combine the Marinade ingredients (except the chicken) in a food processor and blend until smooth. (I do not do this)\n\nMarinade: Combine the Marinade ingredients with the chicken in a bowl. Cover and refrigerate overnight, or up to 24 hours (minimum 3 hrs).\n\nCook chicken: Heat the ghee (butter or oil) over high heat in a large fry pan. Take the chicken out of the Marinade but do not wipe or shake off the marinade from the chicken (but don’t pour the Marinade left in the bowl into the fry pan).\n\nPlace chicken in the fry pan and cook for around 3 minutes, or until the chicken is white all over (it doesn’t really brown because of the Marinade).\n\nSauce: Add the tomato passata, cream, sugar and salt. Also add any remaining marinade left in the bowl. Turn down to low and simmer for 20 minutes. Do a taste test to see if it needs more salt.\n\nGarnish with coriander/cilantro leaves if using. Serve with basmati rice.\n\nRecipe Notes:\n1. Garam Masala is a spice mix that is readily available at supermarkets.\n2. Pure chilli powder - This is not chili powder as Americans know it! Use pure chili powder or cayenne pepper.\n3. Ghee is a clarified butter used in Indian cooking. Can be substituted with butter or standard cooking oil.\n4. Tomato passata is pureed tinned tomatoes (called Tomato Puree in America).\n5. For a lighter version, use 3/4 cup light cream + 1/4 cup milk.`
      );
      setPhoto(butterChickenImg);
      setMode('manual');
    } else if (mealId === '2') {
      setName('Rainbow Chicken Stir Fry');
      setCalories('394');
      setProtein('20');
      setPrepTime('20 min');
      setCookTime('10 min');
      setIngredients([
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
      ]);
      setInstructions(
        `Cook Mode: Prevent screen from sleeping\n\n[ABBREVIATED METHOD]:\nCook chicken until mostly cooked, add garlic and white part of green onion towards end. Add first: capsicum, bok choy stems, cashews and edamame (1 min). Then bok choy leaves, cabbage and green part of green onion (30 seconds). Add sauce, thicken, then finish with sesame oil. Serve!\n\n[FULL INSTRUCTIONS]:\n1. Sauce – In a jug, mix cornflour with a splash of the water until dissolved. Mix in everything else except the remaining water until dissolved. Then add remaining water.\n2. Chicken – Toss chicken with Chinese cooking wine and pepper.\n3. Cook – Heat the oil in a large 30 cm / 12" non stick skillet over high heat. Add chicken then stir constantly until mostly cooked, about 2 minutes.\n4. Add garlic and the white part of green onion, cook for 1 minute.\n5. Add the capsicum, sugar snap peas, bok choy stem, cashews and frozen edamame. Cook 1 minute.\n6. Add bok choy leaves, cabbage and green part of green onions. Toss with two spatulas until slightly wilted (~30 seconds).\n7. Sauce – Add the sauce, stir and let it simmer until it becomes glossy and thickens so it coats everything beautifully, about 1 minute.\n8. Sesame oil – Add sesame oil, toss through, then serve over rice.\n\nRecipe Notes:\n1. Chinese cooking wine brings depth of flavour into any otherwise simple stir fry sauce. Substitute with Mirin, cooking sake, dry sherry, or low-sodium chicken stock (non-alcoholic).\n2. Light soy sauce makes the sauce a paler colour so the vegetable colours are brighter.\n3. Chicken thighs stay nice and juicy. For breast, we recommend tenderising ("velveting").\n4. You can use any vegetables you want, just add them based on how long they take to cook.\n5. Sugar snap peas - Remove the string that runs along both seams and snap the stem end off.\n6. Cooking pan - A large 30cm/12" pan is best to avoid crowding.`
      );
      setPhoto(stirFryImg);
      setMode('manual');
    } else if (mealId === '3') {
      setName('Pesto Pasta');
      setCalories('380');
      setProtein('12');
      setPrepTime('10 min');
      setCookTime('15 min');
      setIngredients([
        '1 quantity homemade pesto (Note 1)',
        '300 – 350 g / 10 – 12 oz pasta of choice (ziti, penne and spaghetti are favourites, Note 2)',
        '2 tsp salt',
        '3/4 cup pasta cooking water',
        'Parmesan, for serving'
      ]);
      setInstructions(
        `Cook Mode: Prevent screen from sleeping\n\n[INSTRUCTIONS]:\n1. Bring a large pot of water to the boil with the salt.\n2. Add pasta and cook for the length of time per the packet.\n3. Just before draining, scoop out 1 cup of of the pasta cooking water.\n4. Drain pasta in a colander, leave it for a minute.\n5. Transfer pasta to a bowl (do NOT use the cooking pot as it is too hot and will turn the basil black).\n6. Add pesto and 1/4 cup of pasta water. Toss to coat pasta in pesto, adding more water if required to make pasta silky and saucy, rather than dry and sticky.\n7. Taste, add more salt and pepper if desired.\n8. Serve immediately, garnished with fresh parmesan.\n\nRecipe Notes:\n1. Pesto – Best with homemade pesto, but works beautifully with store bought. If using store bought, use 1/2 cup+ (store bought is often more concentrated).\n2. Pasta – Ziti and penne are ideal. Spaghetti is next, then other long strand pastas. Use 300g for extra coated saucy pasta, or up to 350g for a standard balanced coat.\n3. General Notes:\n- Never toss pesto pasta on a hot stove (the heat makes basil turn black!).\n- A squeeze of lemon juice makes a optional bright finish.\n- Leftovers store well in an airtight container in the fridge but do not reheat them, enjoy at room temperature instead!`
      );
      setPhoto(pestoImg);
      setMode('manual');
    }
  };

  const renderSelection = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search for recipes..."
          className="w-full pl-12 pr-4 py-4 rounded-full bg-muted/50 border-none focus:ring-2 focus:ring-primary/20 text-sm"
        />
      </div>

      {/* Paste Link Section */}
      <div className="space-y-3">
        <div className="relative flex items-center">
          <input
            type="text"
            value={recipeLink}
            onChange={(e) => setRecipeLink(e.target.value)}
            placeholder="Paste recipe link"
            className="w-full pl-6 pr-24 py-4 rounded-full bg-secondary/20 border-secondary/30 border focus:ring-2 focus:ring-secondary/40 text-sm"
          />
          <button
            onClick={handleAddLink}
            className="absolute right-2 px-6 py-2 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center gap-2 transition-all"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
        {isLinkAnalyzed && (
          <div className="flex items-center gap-2 px-4 text-[10px] font-bold text-primary animate-in fade-in slide-in-from-top-1">
            <CheckCircle2 className="w-3 h-3" />
            Recipe analyzed successfully
          </div>
        )}
      </div>

      {/* Manual Entry Card */}
      <button
        onClick={() => setMode('manual')}
        className="w-full p-6 rounded-sm bg-lavender/20 border border-lavender/30 shadow-sm hover:shadow-md transition-all flex items-center gap-6 text-left group"
      >
        <div className="p-4 rounded-full bg-lavender/30 text-lavender-foreground">
          <Edit3 className="w-6 h-6" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-foreground">Manual Entry</h3>
            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[8px] font-black uppercase tracking-wider">AI POPULATING...</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-tight">Identifying ingredients and cooking time...</p>
        </div>
        <ArrowRight className="w-5 h-5 text-muted-foreground transition-transform" />
      </button>

      {/* Saved Meals Section */}
      <section className="space-y-4">
        <div className="flex justify-between items-end px-2">
          <h2 className="text-lg font-bold text-foreground">Saved Recipes</h2>
          <button 
            onClick={() => navigate('/recipes')}
            className="text-xs font-bold text-primary hover:underline"
          >
            See all
          </button>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-2 px-2">
          {[
            { id: '1', name: 'Butter chicken', time: '20 min prep', img: butterChickenImg, color: 'bg-moss/20 border-moss/30' },
            { id: '2', name: 'Rainbow Chicken Stir Fry', time: '20 min prep', img: stirFryImg, color: 'bg-rose/20 border-rose/30' },
            { id: '3', name: 'Pesto Pasta', time: '10 min prep', img: pestoImg, color: 'bg-sky/20 border-sky/30' }
          ].map((meal) => (
            <button key={meal.id} onClick={() => handleSavedRecipeClick(meal.id)} className={cn("min-w-[160px] rounded-sm overflow-hidden shadow-sm border transition-all text-left cursor-pointer hover:shadow-md hover:border-primary/40", meal.color)}>
              <img src={meal.img} alt={meal.name} className="w-full h-32 object-cover" referrerPolicy="no-referrer" />
              <div className="p-4 space-y-1">
                <h4 className="text-xs font-bold text-foreground leading-tight">{meal.name}</h4>
                <p className="text-[10px] text-muted-foreground">{meal.time}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Recent Meals Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-foreground px-2">Recent Meals</h2>
        <div className="space-y-3">
          {recentMeals.length > 0 ? (
            recentMeals.map((meal, idx) => (
              <div key={meal.id} className={cn(
                "p-5 rounded-sm border shadow-sm flex items-center gap-4 group transition-all hover:shadow-md",
                idx % 4 === 0 ? "bg-moss/20 border-moss/30" : idx % 4 === 1 ? "bg-rose/20 border-rose/30" : idx % 4 === 2 ? "bg-sky/20 border-sky/30" : "bg-lavender/20 border-lavender/30"
              )}>
                <img 
                  src={`https://picsum.photos/seed/${meal.name}/100/100`} 
                  alt={meal.name} 
                  className="w-14 h-14 rounded-full object-cover border-4 border-white shadow-sm"
                  referrerPolicy="no-referrer"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-foreground truncate">{meal.name}</h4>
                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">YESTERDAY</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {meal.calories ? `${meal.calories} kcal • ` : ''}{meal.protein ? `${meal.protein}g protein` : 'Quick meal'}
                  </p>
                </div>
                <button 
                  onClick={() => handleQuickAdd(meal)}
                  className="p-3 rounded-full bg-card/80 text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-all shadow-sm"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-12 rounded-sm bg-muted/30 border-2 border-dashed border-border text-muted-foreground text-xs italic">
              No recent meals yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const renderManual = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 pb-24">
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Meal Name</label>
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Avocado Toast"
              className="w-full p-4 pr-14 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
            />
            <VoiceButton
              className="absolute right-3 top-1/2 -translate-y-1/2"
              onTranscript={(text) => setName(prev => appendDictation(prev, text))}
              label="Dictate meal name"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Calories</label>
            <div className="relative">
              <input
                type="number"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                placeholder="0"
                className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm pr-12"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground/40 uppercase">kcal</span>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Protein</label>
            <div className="relative">
              <input
                type="number"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                placeholder="0"
                className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm pr-12"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground/40 uppercase">g</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Prep Time</label>
            <input
              type="text"
              value={prepTime}
              onChange={(e) => setPrepTime(e.target.value)}
              placeholder="e.g. 10 min"
              className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Cook Time</label>
            <input
              type="text"
              value={cookTime}
              onChange={(e) => setCookTime(e.target.value)}
              placeholder="e.g. 15 min"
              className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Ingredients</label>
          <div className="space-y-2">
            {ingredients.map((ingredient, index) => (
              <input
                key={index}
                type="text"
                value={ingredient}
                onChange={(e) => handleIngredientChange(index, e.target.value)}
                placeholder={`Ingredient ${index + 1}`}
                className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
              />
            ))}
            <button
              onClick={handleAddIngredient}
              className="flex items-center gap-2 text-[10px] font-bold text-primary p-2 hover:bg-primary/10 rounded-lg transition-all uppercase tracking-widest"
            >
              <Plus className="w-3 h-3" />
              Add Ingredient
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Instructions</label>
          <div className="relative">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="How to make it..."
              rows={4}
              className="w-full p-4 pb-14 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm resize-none"
            />
            <VoiceButton
              className="absolute bottom-3 right-3"
              onTranscript={(text) => setInstructions(prev => appendDictation(prev, text))}
              label="Dictate instructions"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Meal Photo</label>
          <div className="flex items-center gap-4">
            <label className="flex-1 flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer">
              <Camera className="w-6 h-6 text-muted-foreground mb-2" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Upload Photo</span>
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            </label>
            {photo && (
              <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-border">
                <img src={photo} alt="Preview" className="w-full h-full object-cover" />
                <button 
                  onClick={() => setPhoto(null)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-primary-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowSaveModal(true)}
        disabled={!name.trim()}
        className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
      >
        Save Meal
      </button>

      <AnimatePresence>
        {showSaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 ">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-sm bg-card rounded-sm p-8 shadow-2xl border border-border space-y-6"
            >
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold tracking-tight">Save Meal</h3>
                <p className="text-sm text-muted-foreground">Where would you like to save this meal?</p>
              </div>
              
              <div className="space-y-3">
                <button
                  onClick={() => handleSave(true)}
                  className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest transition-all"
                >
                  Save to recipes & meal plan
                </button>
                <button
                  onClick={() => handleSave(false)}
                  className="w-full py-4 rounded-2xl bg-muted text-muted-foreground font-bold text-xs uppercase tracking-widest hover:bg-muted/80 transition-all"
                >
                  Just save to meal plan
                </button>
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="w-full py-2 text-xs font-bold text-muted-foreground uppercase tracking-widest"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="space-y-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <button 
          onClick={() => mode === 'selection' ? navigate(-1) : setMode('selection')}
          className="p-2 text-primary hover:bg-primary/10 rounded-full transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-primary tracking-tight">
          {mode === 'selection' ? 'Add New Meal' : 'Manual Entry'}
        </h1>
      </div>

      <div className="space-y-8">
        {mode === 'selection' && renderSelection()}
        {mode === 'manual' && renderManual()}
      </div>
    </div>
  );
};

export default AddMeal;
